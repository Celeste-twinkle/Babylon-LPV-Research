import './style.css'

import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'

import {
  createDirectPreviewRenderer,
  formatDirectPreviewErrorLine,
  formatDirectPreviewMaterialLine,
  formatDirectPreviewStatus,
  formatDirectPreviewSummary,
  installDirectPreviewShaderErrorAudit,
  loadDirectPreviewBundle,
} from './directPreviewRuntime'
import { createSponzaApp } from './sponzaScene'

const DIRECT_BUNDLE_PATH = 'assets/sponza-irradiance-bake.ivpack'

type PreviewSettings = {
  speed: number
  distance: number
  intensity: number
}

const settings: PreviewSettings = {
  speed: 0.62,
  distance: 1.0,
  intensity: 1.0,
}

type PreviewRenderer = 'webgl' | 'webgpu'

const requestedRenderer: PreviewRenderer = location.pathname.toLowerCase().includes('webgpu')
  ? 'webgpu'
  : 'webgl'
const rendererLabel = requestedRenderer === 'webgpu' ? 'WebGPU' : 'WebGL'

PBRBaseMaterial.ForceGLSL = true
StandardMaterial.ForceGLSL = true

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">IV</span>
        <span>
          <strong>Sponza IVOL Direct Preview ${rendererLabel}</strong>
          <small>${rendererLabel} direct baked asset / shared material path</small>
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
      <section class="viewport-panel" aria-label="Direct IVOL preview viewport">
        <canvas id="renderCanvas" aria-label="Sponza direct irradiance volume preview"></canvas>
        <div class="viewport-hud">
          <span id="volumeState">Loading .ivpack</span>
          <span id="sampleReadout">samples: -</span>
        </div>
        <div id="status" class="status">Booting Babylon.js</div>
      </section>

      <aside class="research-panel" aria-label="Direct preview controls">
        <section>
          <p class="eyebrow">direct binary asset</p>
          <h1>Baked light centers.</h1>
          <p>
            This page fetches <code>${DIRECT_BUNDLE_PATH}</code> directly. Several
            PBR diagnostic receivers are created around the default bake light positions.
            Static Sponza uses baked surface lighting; moving receivers sample the volume.
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
            <li id="summaryLine">Waiting for Sponza and .ivpack.</li>
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

try {
  const app = await createSponzaApp(canvas, setStatus, requestedRenderer === 'webgpu')
  const shaderErrors = installDirectPreviewShaderErrorAudit(app)
  const preview = createDirectPreviewRenderer(app, {
    namePrefix: 'direct-preview',
    shaderErrors,
    frameCameraOnLoad: true,
  })
  const bundle = await loadDirectPreviewBundle(DIRECT_BUNDLE_PATH)
  const loaded = await preview.loadBundle(bundle, DIRECT_BUNDLE_PATH)

  volumeState.textContent = 'Direct .ivpack loaded'
  summaryLine.textContent = formatDirectPreviewSummary(loaded)
  materialLine.textContent = formatDirectPreviewMaterialLine(loaded, shaderErrors.length)
  if (loaded.compileAudit.errors.length > 0 || shaderErrors.length > 0) {
    reasonLine.textContent = formatDirectPreviewErrorLine(loaded, shaderErrors)
    setStatus(`Static material audit found shader/material errors. ${loaded.compileAudit.errors[0] ?? shaderErrors[0]}`, true)
  } else {
    reasonLine.textContent =
      `${loaded.dynamicObjects.length} dynamic PBR receiver(s): ${loaded.dynamicObjects.map((object) => object.materialLabel).join(', ')}. Static Sponza uses the same baked material path as validation.`
    setStatus(formatDirectPreviewStatus(loaded))
  }

  app.engine.runRenderLoop(() => {
    syncSettingsFromInputs()
    const frame = preview.renderFrame(settings)
    if (frame) {
      sampleReadout.textContent = frame.sampleReadout
      if (loaded.compileAudit.errors.length === 0 && shaderErrors.length === 0) {
        reasonLine.textContent = frame.reasonLine
      }
    }
    app.scene.render()
  })

  window.addEventListener('beforeunload', () => {
    preview.disposeLoaded()
    app.dispose()
  })
} catch (error) {
  setStatus(`Failed to start direct preview: ${(error as Error).message}`, true)
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

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }

  return element
}
