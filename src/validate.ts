import './style.css'

import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import type { BinaryIrradianceVolume, IrradianceVolumeData } from './irradianceVolume'
import {
  binaryVolumeSummary,
  getProbePosition,
  parseIvolBinary,
  probeIndex,
  sampleBinaryIrradianceVolume,
  sampleIrradianceVolume,
  validateVolumeData,
  volumeSummary,
} from './irradianceVolume'
import type { IrradianceVolumePbrPlugin, IrradianceVolumeTexture } from './irradianceVolumePbrPlugin'
import {
  createIrradianceVolumeTexture,
  installIrradianceVolumePbrPlugins,
  setIrradianceVolumePluginIntensity,
  updateIrradianceVolumePlugins,
} from './irradianceVolumePbrPlugin'
import { createSponzaApp } from './sponzaScene'

type ValidateSettings = {
  speed: number
  height: number
  intensity: number
  showProbes: boolean
}

const settings: ValidateSettings = {
  speed: 0.42,
  height: 0.34,
  intensity: 1.35,
  showProbes: true,
}

type ValidationRenderer = 'webgl' | 'webgpu'

const requestedRenderer: ValidationRenderer = location.pathname.toLowerCase().includes('webgpu')
  ? 'webgpu'
  : 'webgl'
const rendererLabel = requestedRenderer === 'webgpu' ? 'WebGPU' : 'WebGL'

PBRBaseMaterial.ForceGLSL = true
StandardMaterial.ForceGLSL = true

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">V</span>
        <span>
          <strong>IrradianceVolume Validate ${rendererLabel}</strong>
          <small>${rendererLabel} dynamic object world-space sampling</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./">Home</a>
        <a href="./bake.html">Bake</a>
        <a href="./direct-preview.html">Direct Preview</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
        <a href="./validate-webgpu.html">Validate WebGPU</a>
      </nav>
    </header>

    <main class="workspace">
      <section class="viewport-panel" aria-label="Sponza validation viewport">
        <canvas id="renderCanvas" aria-label="Sponza irradiance validation viewport"></canvas>
        <div class="viewport-hud">
          <span id="sampleReadout">sample: -</span>
          <span id="volumeState">Loading volume</span>
        </div>
        <div id="status" class="status">Booting Babylon.js</div>
      </section>

      <aside class="research-panel" aria-label="Validation controls">
        <section>
          <p class="eyebrow">Page 2 / load and verify</p>
          <h1>Validate ${rendererLabel} sampling.</h1>
          <p>
            This page loads the same Sponza scene and applies an imported .ivol
            IrradianceVolume asset to moving dynamic meshes. The sampled object uses
            trilinear interpolation from the probe grid in world space.
          </p>
        </section>

        <section class="control-grid" aria-label="Validation settings">
          <label>
            Motion speed
            <input id="speed" type="number" min="0" max="2" step="0.05" value="${settings.speed}" />
          </label>
          <label>
            Motion height
            <input id="height" type="number" min="0" max="1" step="0.01" value="${settings.height}" />
          </label>
          <label>
            Volume intensity
            <input id="intensity" type="number" min="0" max="4" step="0.05" value="${settings.intensity}" />
          </label>
          <label class="checkbox-label">
            <input id="showProbes" type="checkbox" checked />
            Show probe debug
          </label>
        </section>

        <div class="button-row">
          <button id="uploadVolume" type="button">Upload asset</button>
        </div>
        <input id="volumeFile" class="hidden-file" type="file" accept="application/json,.json,.ivol,application/octet-stream" />

        <section class="note-list">
          <h2>Loaded volume</h2>
          <ol>
            <li id="summaryLine">Waiting for Sponza.</li>
            <li>Sampled mesh: animated sphere and box.</li>
            <li>Reference mesh: unlit sphere nearby.</li>
          </ol>
        </section>
      </aside>
    </main>
  </div>
`

const canvas = mustQuery<HTMLCanvasElement>('#renderCanvas')
const status = mustQuery<HTMLDivElement>('#status')
const volumeState = mustQuery<HTMLSpanElement>('#volumeState')
const sampleReadout = mustQuery<HTMLSpanElement>('#sampleReadout')
const summaryLine = mustQuery<HTMLLIElement>('#summaryLine')
const uploadVolumeButton = mustQuery<HTMLButtonElement>('#uploadVolume')
const volumeFileInput = mustQuery<HTMLInputElement>('#volumeFile')

const setStatus = (message: string, isError = false): void => {
  status.textContent = message
  status.dataset.state = isError ? 'error' : 'ready'
}

type LoadedVolume = IrradianceVolumeData | BinaryIrradianceVolume

let volume: LoadedVolume | null = null
let volumeFocus: Vector3 | null = null
let activeVolumeTexture: IrradianceVolumeTexture | null = null
let pbrPlugins: IrradianceVolumePbrPlugin[] = []
let probeMeshes: Mesh[] = []
let activeMaterial: StandardMaterial
let activeBoxMaterial: StandardMaterial

try {
  const app = await createSponzaApp(canvas, setStatus, requestedRenderer === 'webgpu')
  disableValidationSceneLighting(app)
  pbrPlugins = installIrradianceVolumePbrPlugins(app.importedMeshes)

  activeMaterial = new StandardMaterial('sampled-dynamic-sphere-material', app.scene)
  activeBoxMaterial = new StandardMaterial('sampled-dynamic-box-material', app.scene)

  const neutralMaterial = new StandardMaterial('neutral-reference-material', app.scene)
  neutralMaterial.diffuseColor = new Color3(0.62, 0.62, 0.62)
  neutralMaterial.specularColor = new Color3(0.08, 0.08, 0.08)

  const radius = Math.max(0.18, app.bounds.radius * 0.018)
  const sampledSphere = MeshBuilder.CreateSphere(
    'volume-sampled-sphere',
    { diameter: radius * 2.2, segments: 32 },
    app.scene,
  )
  sampledSphere.material = activeMaterial

  const sampledBox = MeshBuilder.CreateBox(
    'volume-sampled-box',
    { size: radius * 1.8 },
    app.scene,
  )
  sampledBox.material = activeBoxMaterial

  const referenceSphere = MeshBuilder.CreateSphere(
    'neutral-reference-sphere',
    { diameter: radius * 2.2, segments: 32 },
    app.scene,
  )
  referenceSphere.material = neutralMaterial

  volumeState.textContent = 'No volume loaded'
  summaryLine.textContent = 'Upload a .ivol file generated by the bake page.'
  setStatus(`${app.usingWebGPU ? 'WebGPU' : 'WebGL'} Sponza ready. Upload a .ivol asset to validate baked volume lighting.`)

  uploadVolumeButton.addEventListener('click', () => {
    volumeFileInput.click()
  })

  volumeFileInput.addEventListener('change', () => {
    void loadVolumeFromFile(app.scene)
  })

  app.engine.runRenderLoop(() => {
    syncSettingsFromInputs()
    setIrradianceVolumePluginIntensity(pbrPlugins, settings.intensity)

    if (volume) {
      const min = new Vector3(volume.bounds.min[0], volume.bounds.min[1], volume.bounds.min[2])
      const max = new Vector3(volume.bounds.max[0], volume.bounds.max[1], volume.bounds.max[2])
      const size = max.subtract(min)
      const center = volumeFocus ?? min.add(size.scale(0.5))
      const time = performance.now() * 0.001 * settings.speed
      const cellSize = new Vector3(
        size.x / Math.max(1, volume.resolution[0] - 1),
        size.y / Math.max(1, volume.resolution[1] - 1),
        size.z / Math.max(1, volume.resolution[2] - 1),
      )
      const motionScale = Math.max(radius * 3, Math.max(cellSize.x, cellSize.z) * 0.85)
      const y = clamp(center.y + (settings.height - 0.5) * Math.max(cellSize.y, radius), min.y, max.y)

      sampledSphere.position = new Vector3(
        clamp(center.x + Math.sin(time) * motionScale, min.x, max.x),
        clamp(y + Math.sin(time * 1.8) * Math.max(cellSize.y, radius) * 0.35, min.y, max.y),
        clamp(center.z + Math.cos(time * 0.72) * motionScale, min.z, max.z),
      )
      sampledBox.position = sampledSphere.position.add(new Vector3(radius * 2.5, radius * 0.5, 0))
      sampledBox.rotation.y = time * 1.7
      sampledBox.rotation.x = time * 0.7
      referenceSphere.position = sampledSphere.position.add(new Vector3(0, 0, radius * 3.2))

      const sample =
        'kind' in volume
          ? sampleBinaryIrradianceVolume(volume, sampledSphere.position)
          : sampleIrradianceVolume(volume, sampledSphere.position)
      const ambient = sample.ambient.scale(settings.intensity)
      activeMaterial.diffuseColor = ambient
      activeMaterial.emissiveColor = ambient.scale(0.58)
      activeMaterial.specularColor = new Color3(0.05, 0.05, 0.05)
      activeBoxMaterial.diffuseColor = Color3.Lerp(ambient, new Color3(0.22, 0.54, 0.9), 0.22)
      activeBoxMaterial.emissiveColor = ambient.scale(0.44)
      activeBoxMaterial.specularColor = new Color3(0.05, 0.05, 0.05)

      sampleReadout.textContent =
        `sample: ${ambient.r.toFixed(2)}, ${ambient.g.toFixed(2)}, ${ambient.b.toFixed(2)}`
    } else {
      const center = app.bounds.center
      const time = performance.now() * 0.001 * settings.speed
      sampledSphere.position = new Vector3(
        center.x + Math.sin(time) * app.bounds.size.x * 0.18,
        center.y,
        center.z + Math.cos(time * 0.72) * app.bounds.size.z * 0.18,
      )
      sampledBox.position = sampledSphere.position.add(new Vector3(radius * 2.5, radius * 0.5, 0))
      referenceSphere.position = sampledSphere.position.add(new Vector3(0, 0, radius * 3.2))
      activeMaterial.diffuseColor = Color3.Black()
      activeMaterial.emissiveColor = Color3.Black()
      activeMaterial.specularColor = Color3.Black()
      activeBoxMaterial.diffuseColor = Color3.Black()
      activeBoxMaterial.emissiveColor = Color3.Black()
      activeBoxMaterial.specularColor = Color3.Black()
      sampleReadout.textContent = 'sample: no volume'
    }

    for (const mesh of probeMeshes) {
      mesh.isVisible = settings.showProbes
    }

    app.scene.render()
  })

  window.addEventListener('beforeunload', () => {
    disposeProbeMeshes()
    activeVolumeTexture?.ambientTexture.dispose()
    activeVolumeTexture?.directionTexture.dispose()
    app.dispose()
  })
} catch (error) {
  setStatus(`Failed to start validation page: ${(error as Error).message}`, true)
}

function disableValidationSceneLighting(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  app.scene.clearColor = new Color4(0, 0, 0, 1)
  app.scene.ambientColor = Color3.Black()
  app.scene.environmentIntensity = 0
  app.scene.environmentTexture = null

  for (const light of app.scene.lights) {
    light.intensity = 0
    light.setEnabled(false)
  }

  app.bakeLight.intensity = 0
  app.bakeLight.setEnabled(false)
}

async function loadVolumeFromFile(scene: Scene): Promise<void> {
  const file = volumeFileInput.files?.[0]

  if (!file) {
    return
  }

  try {
    const buffer = await file.arrayBuffer()
    if (hasIvolMagic(buffer)) {
      setVolume(scene, parseIvolBinary(buffer), `Uploaded ${file.name}`)
    } else {
      const text = new TextDecoder().decode(buffer)
      setVolume(scene, validateVolumeData(JSON.parse(text)), `Uploaded ${file.name}`)
    }
  } catch (error) {
    setStatus(`Could not load volume asset: ${(error as Error).message}`, true)
  } finally {
    volumeFileInput.value = ''
  }
}

function setVolume(scene: Scene, nextVolume: LoadedVolume, source: string): void {
  volume = nextVolume
  volumeFocus = findBrightestProbePosition(nextVolume)
  activeVolumeTexture?.ambientTexture.dispose()
  activeVolumeTexture?.directionTexture.dispose()
  activeVolumeTexture = createIrradianceVolumeTexture(scene, nextVolume)
  updateIrradianceVolumePlugins(pbrPlugins, activeVolumeTexture, settings.intensity)

  if ('kind' in nextVolume) {
    createBinaryProbeDebug(nextVolume)
  } else {
    createProbeDebug(nextVolume)
  }
  volumeState.textContent = source
  const summary = 'kind' in nextVolume ? binaryVolumeSummary(nextVolume) : volumeSummary(nextVolume)
  const focusText = volumeFocus
    ? ` Brightest probe: ${volumeFocus.x.toFixed(2)}, ${volumeFocus.y.toFixed(2)}, ${volumeFocus.z.toFixed(2)}.`
    : ''
  summaryLine.textContent = `${source}: ${summary}.${focusText}`
  setStatus(`${source}: ${summary}${focusText}`)
}

function findBrightestProbePosition(nextVolume: LoadedVolume): Vector3 | null {
  let brightestIndex = -1
  let brightestEnergy = Number.NEGATIVE_INFINITY

  if ('kind' in nextVolume) {
    const probeCount = nextVolume.payload.length / nextVolume.probeStrideFloats
    for (let index = 0; index < probeCount; index += 1) {
      const base = index * nextVolume.probeStrideFloats
      const energy =
        nextVolume.payload[base] +
        nextVolume.payload[base + 1] +
        nextVolume.payload[base + 2]

      if (energy > brightestEnergy) {
        brightestEnergy = energy
        brightestIndex = index
      }
    }
  } else {
    for (let index = 0; index < nextVolume.probes.length; index += 1) {
      const probe = nextVolume.probes[index]
      const energy = probe.ambient[0] + probe.ambient[1] + probe.ambient[2]

      if (energy > brightestEnergy) {
        brightestEnergy = energy
        brightestIndex = index
      }
    }
  }

  if (brightestIndex < 0 || !Number.isFinite(brightestEnergy)) {
    return null
  }

  const x = brightestIndex % nextVolume.resolution[0]
  const y = Math.floor(brightestIndex / nextVolume.resolution[0]) % nextVolume.resolution[1]
  const z = Math.floor(brightestIndex / (nextVolume.resolution[0] * nextVolume.resolution[1]))

  return getProbePosition(nextVolume, x, y, z)
}

function createProbeDebug(nextVolume: IrradianceVolumeData): void {
  disposeProbeMeshes()

  const markerSize = Math.max(
    0.08,
    (nextVolume.bounds.max[0] - nextVolume.bounds.min[0]) / Math.max(60, nextVolume.resolution[0] * 6),
  )
  const maxMarkers = 650
  const stride = Math.max(1, Math.ceil(nextVolume.probes.length / maxMarkers))
  const marker = MeshBuilder.CreateSphere('validate-probe-marker-template', {
    diameter: markerSize,
    segments: 6,
  })
  marker.isVisible = false

  for (let z = 0; z < nextVolume.resolution[2]; z += 1) {
    for (let y = 0; y < nextVolume.resolution[1]; y += 1) {
      for (let x = 0; x < nextVolume.resolution[0]; x += 1) {
        const index = probeIndex(x, y, z, nextVolume.resolution)
        if (index % stride !== 0) {
          continue
        }

        const probe = nextVolume.probes[index]
        const mesh = marker.clone(`validate-probe-marker-${index}`) as Mesh
        const material = new StandardMaterial(`validate-probe-marker-material-${index}`)
        const color = new Color3(probe.ambient[0], probe.ambient[1], probe.ambient[2])

        mesh.position.copyFrom(getProbePosition(nextVolume, x, y, z))
        mesh.isPickable = false
        mesh.isVisible = settings.showProbes
        material.disableLighting = true
        material.diffuseColor = color
        material.emissiveColor = color
        mesh.material = material
        probeMeshes.push(mesh)
      }
    }
  }

  marker.dispose()
}

function createBinaryProbeDebug(nextVolume: BinaryIrradianceVolume): void {
  disposeProbeMeshes()

  const markerSize = Math.max(
    0.08,
    (nextVolume.bounds.max[0] - nextVolume.bounds.min[0]) / Math.max(60, nextVolume.resolution[0] * 6),
  )
  const maxMarkers = 650
  const stride = Math.max(1, Math.ceil((nextVolume.payload.length / nextVolume.probeStrideFloats) / maxMarkers))
  const marker = MeshBuilder.CreateSphere('validate-binary-probe-marker-template', {
    diameter: markerSize,
    segments: 6,
  })
  marker.isVisible = false

  for (let z = 0; z < nextVolume.resolution[2]; z += 1) {
    for (let y = 0; y < nextVolume.resolution[1]; y += 1) {
      for (let x = 0; x < nextVolume.resolution[0]; x += 1) {
        const index = probeIndex(x, y, z, nextVolume.resolution)
        if (index % stride !== 0) {
          continue
        }

        const base = index * nextVolume.probeStrideFloats
        const mesh = marker.clone(`validate-binary-probe-marker-${index}`) as Mesh
        const material = new StandardMaterial(`validate-binary-probe-marker-material-${index}`)
        const color = new Color3(
          nextVolume.payload[base],
          nextVolume.payload[base + 1],
          nextVolume.payload[base + 2],
        )

        mesh.position.copyFrom(getProbePosition(nextVolume, x, y, z))
        mesh.isPickable = false
        mesh.isVisible = settings.showProbes
        material.disableLighting = true
        material.diffuseColor = color
        material.emissiveColor = color
        mesh.material = material
        probeMeshes.push(mesh)
      }
    }
  }

  marker.dispose()
}

function disposeProbeMeshes(): void {
  for (const mesh of probeMeshes) {
    const material = mesh.material
    mesh.dispose()
    material?.dispose()
  }
  probeMeshes = []
}

function syncSettingsFromInputs(): void {
  settings.speed = readNumber('#speed', settings.speed)
  settings.height = readNumber('#height', settings.height)
  settings.intensity = readNumber('#intensity', settings.intensity)
  settings.showProbes = mustQuery<HTMLInputElement>('#showProbes').checked
}

function readNumber(selector: string, defaultValue: number): number {
  const value = Number(mustQuery<HTMLInputElement>(selector).value)

  return Number.isFinite(value) ? value : defaultValue
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }

  return element
}

function hasIvolMagic(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))

  return bytes[0] === 0x49 && bytes[1] === 0x56 && bytes[2] === 0x4f && bytes[3] === 0x4c
}
