import './style.css'

import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import { DEFAULT_BAKE_LIGHT_CONFIGS } from './defaultBakeLights'
import type { BinaryIrradianceVolume } from './irradianceVolume'
import {
  binaryVolumeSummary,
  parseIvolBinary,
  sampleBinaryIrradianceVolume,
} from './irradianceVolume'
import type { IrradianceVolumeTexture } from './irradianceVolumePbrPlugin'
import {
  createIrradianceVolumeTexture,
  installIrradianceVolumePbrPlugins,
  IrradianceVolumePbrPlugin,
  setIrradianceVolumePluginIntensity,
  updateIrradianceVolumePlugins,
} from './irradianceVolumePbrPlugin'
import { createSponzaApp } from './sponzaScene'

const DIRECT_IVOL_PATH = 'assets/sponza-irradiance-volume-4.ivol'

type PreviewSettings = {
  speed: number
  distance: number
  intensity: number
}

type DynamicProbeObject = {
  mesh: Mesh
  material: PBRMaterial
  plugin: IrradianceVolumePbrPlugin
  center: Vector3
  name: string
  phase: number
  axisDistance: number
}

const settings: PreviewSettings = {
  speed: 0.62,
  distance: 1.0,
  intensity: 1.35,
}

PBRBaseMaterial.ForceGLSL = true
StandardMaterial.ForceGLSL = true

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">IV</span>
        <span>
          <strong>Sponza IVOL Direct Preview</strong>
          <small>direct baked asset / dynamic PBR material check</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./">Home</a>
        <a href="./bake.html">Bake</a>
        <a href="./direct-preview.html">Direct Preview</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
      </nav>
    </header>

    <main class="workspace">
      <section class="viewport-panel" aria-label="Direct IVOL preview viewport">
        <canvas id="renderCanvas" aria-label="Sponza direct irradiance volume preview"></canvas>
        <div class="viewport-hud">
          <span id="volumeState">Loading .ivol</span>
          <span id="sampleReadout">samples: -</span>
        </div>
        <div id="status" class="status">Booting Babylon.js</div>
      </section>

      <aside class="research-panel" aria-label="Direct preview controls">
        <section>
          <p class="eyebrow">direct binary asset</p>
          <h1>Baked light centers.</h1>
          <p>
            This page fetches <code>${DIRECT_IVOL_PATH}</code> directly. Four neutral
            PBR objects are created around the default bake light positions, then rotate
            while moving toward and away from each light center.
          </p>
        </section>

        <section class="control-grid" aria-label="Preview settings">
          <label>
            Motion speed
            <input id="speed" type="number" min="0" max="2" step="0.05" value="${settings.speed}" />
          </label>
          <label>
            Travel scale
            <input id="distance" type="number" min="0" max="2" step="0.05" value="${settings.distance}" />
          </label>
          <label>
            Volume intensity
            <input id="intensity" type="number" min="0" max="4" step="0.05" value="${settings.intensity}" />
          </label>
        </section>

        <section class="note-list">
          <h2>Material audit</h2>
          <ol>
            <li id="summaryLine">Waiting for Sponza and .ivol.</li>
            <li id="materialLine">Dynamic materials are not initialized yet.</li>
            <li id="reasonLine">Distance color changes are diagnosed after samples are available.</li>
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
const materialLine = mustQuery<HTMLLIElement>('#materialLine')
const reasonLine = mustQuery<HTMLLIElement>('#reasonLine')

const setStatus = (message: string, isError = false): void => {
  status.textContent = message
  status.dataset.state = isError ? 'error' : 'ready'
}

let volumeTexture: IrradianceVolumeTexture | null = null

try {
  const app = await createSponzaApp(canvas, setStatus, false)
  disableRuntimeLighting(app)

  const volume = await loadDirectVolume()
  volumeTexture = createIrradianceVolumeTexture(app.scene, volume)

  const staticPlugins = installIrradianceVolumePbrPlugins(app.importedMeshes)
  const dynamicObjects = createDynamicObjects(app.scene, volume)
  const dynamicPlugins = dynamicObjects.map((object) => object.plugin)
  const allPlugins = [...staticPlugins, ...dynamicPlugins]

  updateIrradianceVolumePlugins(allPlugins, volumeTexture, settings.intensity)
  volumeState.textContent = 'Direct .ivol loaded'
  summaryLine.textContent = `${DIRECT_IVOL_PATH}: ${binaryVolumeSummary(volume)}.`
  materialLine.textContent =
    `${dynamicObjects.length} dynamic objects use neutral PBRMaterial, metallic 0, roughness 0.72, with one IVOL PBR plugin each.`
  setStatus(`Loaded direct binary volume: ${binaryVolumeSummary(volume)}.`)

  app.engine.runRenderLoop(() => {
    syncSettingsFromInputs()
    setIrradianceVolumePluginIntensity(allPlugins, settings.intensity)

    const time = performance.now() * 0.001 * settings.speed
    const sampleTexts: string[] = []
    let maxChroma = 0
    let minEnergy = Number.POSITIVE_INFINITY
    let maxEnergy = 0

    for (let index = 0; index < dynamicObjects.length; index += 1) {
      const object = dynamicObjects[index]
      animateObject(object, time, settings.distance, volume)

      const sample = sampleBinaryIrradianceVolume(volume, object.mesh.position)
      const ambient = sample.ambient.scale(settings.intensity)
      const energy = ambient.r + ambient.g + ambient.b
      const chroma = Math.max(ambient.r, ambient.g, ambient.b) - Math.min(ambient.r, ambient.g, ambient.b)
      const distance = Vector3.Distance(object.mesh.position, object.center)

      minEnergy = Math.min(minEnergy, energy)
      maxEnergy = Math.max(maxEnergy, energy)
      maxChroma = Math.max(maxChroma, chroma)
      sampleTexts.push(`${object.name}:${ambient.r.toFixed(2)},${ambient.g.toFixed(2)},${ambient.b.toFixed(2)} d=${distance.toFixed(1)}`)
    }

    const energyRatio = maxEnergy / Math.max(0.0001, minEnergy)
    reasonLine.textContent = buildReasonLine(maxChroma, energyRatio)
    sampleReadout.textContent = `samples: ${sampleTexts.join(' | ')}`
    app.scene.render()
  })

  window.addEventListener('beforeunload', () => {
    for (const object of dynamicObjects) {
      object.material.dispose()
      object.mesh.dispose()
    }
    volumeTexture?.ambientTexture.dispose()
    volumeTexture?.directionTexture.dispose()
    app.dispose()
  })
} catch (error) {
  setStatus(`Failed to start direct preview: ${(error as Error).message}`, true)
}

async function loadDirectVolume(): Promise<BinaryIrradianceVolume> {
  const response = await fetch(assetUrl(DIRECT_IVOL_PATH))

  if (!response.ok) {
    throw new Error(`Could not fetch ${DIRECT_IVOL_PATH}: HTTP ${response.status}.`)
  }

  return parseIvolBinary(await response.arrayBuffer())
}

function createDynamicObjects(
  scene: Awaited<ReturnType<typeof createSponzaApp>>['scene'],
  volume: BinaryIrradianceVolume,
): DynamicProbeObject[] {
  const volumeSize = new Vector3(
    volume.bounds.max[0] - volume.bounds.min[0],
    volume.bounds.max[1] - volume.bounds.min[1],
    volume.bounds.max[2] - volume.bounds.min[2],
  )
  const radius = Math.max(0.22, Math.min(volumeSize.x, volumeSize.z) * 0.018)

  return DEFAULT_BAKE_LIGHT_CONFIGS.map((light, index) => {
    const center = new Vector3(light.x, light.y, light.z)
    const mesh = index % 2 === 0
      ? MeshBuilder.CreateSphere(`direct-preview-pbr-object-${light.id}`, {
        diameter: radius * 2.2,
        segments: 32,
      }, scene)
      : MeshBuilder.CreateBox(`direct-preview-pbr-object-${light.id}`, {
        size: radius * 2.0,
      }, scene)
    const material = new PBRMaterial(`direct-preview-pbr-material-${light.id}`, scene)

    material.albedoColor = new Color3(0.86, 0.86, 0.82)
    material.metallic = 0
    material.roughness = 0.72
    material.directIntensity = 1
    material.environmentIntensity = 0
    mesh.material = material

    return {
      mesh,
      material,
      plugin: new IrradianceVolumePbrPlugin(material),
      center,
      name: light.name,
      phase: index * Math.PI * 0.5,
      axisDistance: Math.max(1.4, light.range * 0.36),
    }
  })
}

function animateObject(
  object: DynamicProbeObject,
  time: number,
  distanceScale: number,
  volume: BinaryIrradianceVolume,
): void {
  const radialDistance = object.axisDistance * (0.18 + 0.82 * (0.5 + 0.5 * Math.sin(time * 1.25 + object.phase))) * distanceScale
  const orbit = time * 0.62 + object.phase
  const yBob = Math.sin(time * 1.8 + object.phase) * 0.28
  const offset = new Vector3(
    Math.cos(orbit) * radialDistance,
    yBob,
    Math.sin(orbit) * radialDistance,
  )

  object.mesh.position.copyFrom(clampToVolume(object.center.add(offset), volume))
  object.mesh.rotation.x = time * 0.75 + object.phase
  object.mesh.rotation.y = time * 1.25
  object.mesh.rotation.z = time * 0.35
}

function clampToVolume(position: Vector3, volume: BinaryIrradianceVolume): Vector3 {
  return new Vector3(
    clamp(position.x, volume.bounds.min[0], volume.bounds.max[0]),
    clamp(position.y, volume.bounds.min[1], volume.bounds.max[1]),
    clamp(position.z, volume.bounds.min[2], volume.bounds.max[2]),
  )
}

function buildReasonLine(maxChroma: number, energyRatio: number): string {
  if (maxChroma < 0.08 && energyRatio < 1.35) {
    return 'Weak visible change: the .ivol stores smoothed irradiance probes, samples are clamped inside the volume, and the bake includes indirect/bounced energy instead of raw point-light falloff.'
  }

  return `Sample variation is present: max channel spread ${maxChroma.toFixed(2)}, brightness ratio ${energyRatio.toFixed(2)}. Trilinear probe interpolation still smooths local point-light color changes.`
}

function disableRuntimeLighting(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
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

function syncSettingsFromInputs(): void {
  settings.speed = readNumber('#speed', settings.speed)
  settings.distance = readNumber('#distance', settings.distance)
  settings.intensity = readNumber('#intensity', settings.intensity)
}

function readNumber(selector: string, defaultValue: number): number {
  const value = Number(mustQuery<HTMLInputElement>(selector).value)

  return Number.isFinite(value) ? value : defaultValue
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/')
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
