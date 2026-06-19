import './style.css'

import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'

import type { BinaryIrradianceVolume } from './irradianceVolume'
import { getProbePosition, probeIndex } from './irradianceVolume'
import type { DirectPreviewRenderer } from './directPreviewRuntime'
import {
  createDirectPreviewRenderer,
  formatDirectPreviewErrorLine,
  formatDirectPreviewStatus,
  formatDirectPreviewSummary,
  installDirectPreviewShaderErrorAudit,
} from './directPreviewRuntime'
import {
  hasIrradianceBakeBundleMagic,
  parseIrradianceBakeBundle,
} from './irradianceBakeBundle'
import { createSponzaApp } from './sponzaScene'

type ValidateSettings = {
  speed: number
  distance: number
  intensity: number
  showProbes: boolean
}

const settings: ValidateSettings = {
  speed: 0.62,
  distance: 1.0,
  intensity: 1.0,
  showProbes: false,
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
          <small>${rendererLabel} direct preview renderer with uploaded asset</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./">Home</a>
        <a href="./bake.html">Bake</a>
        <a href="./direct-preview-webgl.html">Preview WebGL</a>
        <a href="./direct-preview-webgpu.html">Preview WebGPU</a>
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
            This page uploads an .ivpack and renders it through the same direct
            preview runtime used by the preview pages.
          </p>
        </section>

        <section class="control-grid" aria-label="Validation settings">
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
          <label class="checkbox-label">
            <input id="showProbes" type="checkbox" ${settings.showProbes ? 'checked' : ''} />
            Show probe debug
          </label>
        </section>

        <div class="button-row">
          <button id="uploadVolume" type="button">Upload asset</button>
        </div>
        <input id="volumeFile" class="hidden-file" type="file" accept=".ivpack,application/octet-stream" />

        <section class="note-list">
          <h2>Loaded volume</h2>
          <ol>
            <li id="summaryLine">Waiting for Sponza.</li>
            <li>Rendering path: direct preview runtime.</li>
            <li>Probe debug is visual-only and does not affect materials.</li>
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

let probeMeshes: Mesh[] = []

try {
  const app = await createSponzaApp(canvas, setStatus, requestedRenderer === 'webgpu')
  const shaderErrors = installDirectPreviewShaderErrorAudit(app)
  const preview = createDirectPreviewRenderer(app, {
    namePrefix: 'validate',
    shaderErrors,
    frameCameraOnLoad: false,
  })

  uploadVolumeButton.addEventListener('click', () => {
    volumeFileInput.click()
  })

  volumeFileInput.addEventListener('change', () => {
    void loadVolumeFromFile(preview, shaderErrors)
  })

  volumeState.textContent = 'No volume loaded'
  summaryLine.textContent = 'Upload a .ivpack file generated by the bake page.'
  setStatus(`${app.usingWebGPU ? 'WebGPU' : 'WebGL'} Sponza ready. Upload a .ivpack asset to validate the direct preview path.`)

  app.engine.runRenderLoop(() => {
    syncSettingsFromInputs()
    const frame = preview.renderFrame(settings)

    sampleReadout.textContent = frame?.sampleReadout ?? 'sample: no volume'
    for (const mesh of probeMeshes) {
      mesh.isVisible = settings.showProbes
    }

    if (preview.loaded) {
      app.scene.render()
    }
  })

  window.addEventListener('beforeunload', () => {
    disposeProbeMeshes()
    preview.disposeLoaded()
    app.dispose()
  })
} catch (error) {
  setStatus(`Failed to start validation page: ${(error as Error).message}`, true)
}

async function loadVolumeFromFile(
  preview: DirectPreviewRenderer,
  shaderErrors: string[],
): Promise<void> {
  const file = volumeFileInput.files?.[0]

  if (!file) {
    return
  }

  try {
    const buffer = await file.arrayBuffer()
    if (!hasIrradianceBakeBundleMagic(buffer)) {
      throw new Error('Expected a .ivpack irradiance bake bundle.')
    }

    disposeProbeMeshes()
    const bundle = parseIrradianceBakeBundle(buffer)
    const sourceLabel = `Uploaded ${file.name}`
    const loaded = await preview.loadBundle(bundle, sourceLabel)

    createBinaryProbeDebug(loaded.volume)
    volumeState.textContent = sourceLabel
    summaryLine.textContent = formatDirectPreviewSummary(loaded)
    if (loaded.compileAudit.errors.length > 0 || shaderErrors.length > 0) {
      setStatus(formatDirectPreviewErrorLine(loaded, shaderErrors), true)
    } else {
      setStatus(formatDirectPreviewStatus(loaded))
    }
  } catch (error) {
    setStatus(`Could not load irradiance bake bundle: ${(error as Error).message}`, true)
  } finally {
    volumeFileInput.value = ''
  }
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
  settings.distance = readNumber('#distance', settings.distance)
  settings.intensity = readNumber('#intensity', settings.intensity)
  settings.showProbes = mustQuery<HTMLInputElement>('#showProbes').checked
}

function readNumber(selector: string, defaultValue: number): number {
  const value = Number(mustQuery<HTMLInputElement>(selector).value)

  return Number.isFinite(value) ? value : defaultValue
}

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }

  return element
}
