import './style.css'

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager'
import { LightConstants } from '@babylonjs/core/Lights/lightConstants'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { Pane } from 'tweakpane'

import type { IrradianceVolumeData, Vec3Tuple } from './irradianceVolume'
import {
  binaryVolumeSummary,
  getProbePosition,
  parseIvolBinary,
  probeIndex,
  vector3ToTuple,
} from './irradianceVolume'
import type { BakeLightConfig } from './defaultBakeLights'
import { createDefaultBakeLightConfigs } from './defaultBakeLights'
import { createSponzaApp, volumeBoundsFromScene } from './sponzaScene'
import {
  bakeIrradianceVolumeWebGPU,
  canUseWebGPUCompute,
} from './webgpuBake'
import {
  createIrradianceBakeBundle,
  irradianceBakeBundleQualitySummary,
  irradianceBakeBundleSummary,
  parseIrradianceBakeBundle,
} from './irradianceBakeBundle'
import {
  bakeStaticShadowMask,
} from './staticShadowMask'

type BakeSettings = {
  resolutionX: number
  resolutionY: number
  resolutionZ: number
  bounces: number
  bounceRayCount: number
  areaSamples: number
  accumulationSamples: number
  exposure: number
  maxProbeCount: number
  shadowMaskResolution: number
}

const settings: BakeSettings = {
  resolutionX: 64,
  resolutionY: 32,
  resolutionZ: 64,
  bounces: 4,
  bounceRayCount: 4,
  areaSamples: 4,
  accumulationSamples: 4,
  exposure: 1.0,
  maxProbeCount: 262144,
  shadowMaskResolution: 2048,
}

const SHADOW_MASK_RESOLUTION_OPTIONS = {
  '512 px': 512,
  '1024 px': 1024,
  '2048 px': 2048,
  '4096 px': 4096,
}

const SHADOW_MASK_RESOLUTIONS = Object.values(SHADOW_MASK_RESOLUTION_OPTIONS)

type BakeLightRuntime = {
  config: BakeLightConfig
  light: PointLight
  marker: Mesh
  radiusMesh: Mesh
  markerMaterial: StandardMaterial
  radiusMaterial: StandardMaterial
}

type PaneFolder = ReturnType<Pane['addFolder']>

const MAX_BAKE_LIGHTS = 8
const lightConfigs: BakeLightConfig[] = createDefaultBakeLightConfigs()
const lightSelection = {
  selectedLightId: lightConfigs[0].id,
}
let nextLightId = 5

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./">
        <span class="brand-mark" aria-hidden="true">B</span>
        <span>
          <strong>IrradianceVolume Bake</strong>
          <small>Sponza WebGPU multi-light baker</small>
        </span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="./">Home</a>
        <a href="./direct-preview-webgl.html">Preview WebGL</a>
        <a href="./direct-preview-webgpu.html">Preview WebGPU</a>
        <a href="./validate-webgl.html">Validate WebGL</a>
        <a href="./validate-webgpu.html">Validate WebGPU</a>
      </nav>
    </header>

    <main class="workspace">
      <section class="viewport-panel" aria-label="Sponza bake viewport">
        <canvas id="renderCanvas" aria-label="Sponza irradiance bake viewport"></canvas>
        <div class="viewport-hud">
          <span id="probeCount">0 probes</span>
          <span id="volumeState">No bake yet</span>
        </div>
        <div id="status" class="status">Booting Babylon.js</div>
      </section>

      <aside class="research-panel" aria-label="Bake controls">
        <section>
          <p class="eyebrow">Page 1 / generate data</p>
          <h1>Bake Sponza volume data.</h1>
          <p>
            This page loads the Sponza model and generates a regular-grid IrradianceVolume
            asset. WebGPU mode jointly bakes adjustable Babylon physical PointLights into
            a single .ivpack bundle with base/detail irradiance volumes and static shadowmask data.
          </p>
        </section>

        <section class="tweakpane-section" aria-label="Bake settings">
          <div id="tweakpaneHost" class="tweakpane-host"></div>
        </section>

        <div class="button-row">
          <button id="bakeVolume" type="button">Bake WebGPU .ivpack</button>
          <button id="downloadVolume" type="button" disabled>Download asset</button>
        </div>

        <section class="progress-panel" aria-label="Bake progress">
          <div class="progress-copy">
            <span>Bake progress</span>
            <strong id="progressPercent">0%</strong>
          </div>
          <progress id="bakeProgress" value="0" max="100"></progress>
          <p id="progressLabel">Waiting for bake.</p>
        </section>

        <section class="note-list">
          <h2>Output</h2>
          <ol>
            <li id="summaryLine">Waiting for Sponza.</li>
            <li>Bundle asset name: <code>sponza-irradiance-bake.ivpack</code></li>
            <li>Use the downloaded .ivpack file in the validation page.</li>
          </ol>
        </section>
      </aside>
    </main>
  </div>
`

const canvas = mustQuery<HTMLCanvasElement>('#renderCanvas')
const status = mustQuery<HTMLDivElement>('#status')
const probeCount = mustQuery<HTMLSpanElement>('#probeCount')
const volumeState = mustQuery<HTMLSpanElement>('#volumeState')
const summaryLine = mustQuery<HTMLLIElement>('#summaryLine')
const tweakpaneHost = mustQuery<HTMLDivElement>('#tweakpaneHost')
const bakeButton = mustQuery<HTMLButtonElement>('#bakeVolume')
const downloadButton = mustQuery<HTMLButtonElement>('#downloadVolume')
const bakeProgress = mustQuery<HTMLProgressElement>('#bakeProgress')
const progressPercent = mustQuery<HTMLElement>('#progressPercent')
const progressLabel = mustQuery<HTMLParagraphElement>('#progressLabel')

const setStatus = (message: string, isError = false): void => {
  status.textContent = message
  status.dataset.state = isError ? 'error' : 'ready'
}

const setBakeProgress = (percent: number, message: string): void => {
  const clamped = Math.min(100, Math.max(0, percent))

  bakeProgress.value = clamped
  progressPercent.textContent = `${Math.round(clamped)}%`
  progressLabel.textContent = message
}

let latestBinary: ArrayBuffer | null = null
let latestDetailBinary: ArrayBuffer | null = null
let latestShadowMaskBinary: ArrayBuffer | null = null
let latestBundleBinary: ArrayBuffer | null = null
let probeMeshes: Mesh[] = []
let probeMaterials: StandardMaterial[] = []
let boundsMesh: Mesh | null = null
let lightRuntimes: BakeLightRuntime[] = []
let lightGizmo: GizmoManager | null = null
let pane: Pane | null = null
let activeScene: Scene | null = null
let hasGeneratedBake = false

try {
  const app = await createSponzaApp(canvas, setStatus, true, true)
  activeScene = app.scene
  const volumeBounds = volumeBoundsFromScene(app.bounds)
  createBoundsMesh(volumeBounds)
  createBakeLights(app)
  createBakePane(app)
  setBakeProgress(0, 'Waiting for bake.')

  app.engine.runRenderLoop(() => {
    if (lightGizmo?.isDragging) {
      syncSelectedLightFromGizmo()
    }
    app.scene.render()
  })

  bakeButton.disabled = false
  summaryLine.textContent =
    `Scene volume bounds ready. Renderer: WebGPU baker. Model radius: ${app.bounds.radius.toFixed(2)}.`

  bakeButton.addEventListener('click', () => {
    if (!canUseWebGPUCompute(app.engine)) {
      setStatus('WebGPU compute shaders are required for baking on this page.', true)
      setBakeProgress(0, 'Bake requires WebGPU compute.')

      return
    }

    void bakeWebGPU(app, volumeBounds)
  })

  downloadButton.addEventListener('click', () => {
    if (latestBundleBinary) {
      downloadBundle(latestBundleBinary)
    }
  })

  window.addEventListener('beforeunload', () => {
    disposeProbeMeshes()
    boundsMesh?.dispose()
    disposeBakeLights()
    lightGizmo?.dispose()
    pane?.dispose()
    app.dispose()
  })
} catch (error) {
  setStatus(`Failed to start bake page: ${(error as Error).message}`, true)
}

async function bakeWebGPU(
  app: Awaited<ReturnType<typeof createSponzaApp>>,
  bounds: IrradianceVolumeData['bounds'],
): Promise<void> {
  sanitizeBakeSettings()
  syncAllBakeLights()
  bakeButton.disabled = true
  downloadButton.disabled = true
  latestBundleBinary = null
  latestBinary = null
  latestDetailBinary = null
  latestShadowMaskBinary = null
  disposeProbeMeshes()
  const enabledLights = getEnabledLightRuntimes()

  const requestedResolution: Vec3Tuple = [
    settings.resolutionX,
    settings.resolutionY,
    settings.resolutionZ,
  ]
  const resolution = fitResolutionToProbeBudget(requestedResolution, getBaseProbeBudget())
  const requestedProbeCount = requestedResolution[0] * requestedResolution[1] * requestedResolution[2]
  const actualProbeCount = resolution[0] * resolution[1] * resolution[2]
  const detailBounds = createDetailVolumeBounds(bounds, app.importedMeshes)
  const detailResolution = fitDetailResolutionToProbeBudget(
    requestedResolution,
    bounds,
    detailBounds,
    getDetailProbeBudget(),
  )
  const detailProbeCount = detailResolution[0] * detailResolution[1] * detailResolution[2]

  setStatus('WebGPU baking physical Babylon lights...')
  volumeState.textContent = 'WebGPU baking...'
  probeCount.textContent = `${actualProbeCount} base + ${detailProbeCount} detail probes`
  setBakeProgress(8, 'Preparing WebGPU buffers.')

  try {
    if (enabledLights.length === 0) {
      throw new Error('Enable at least one point light before baking.')
    }

    const result = await bakeIrradianceVolumeWebGPU({
      engine: app.engine,
      bounds,
      resolution,
      lights: enabledLights.map((runtime) => runtime.light),
      geometry: app.importedMeshes,
      exposure: settings.exposure,
      bounces: settings.bounces,
      areaSamples: settings.areaSamples,
      bounceRayCount: settings.bounceRayCount,
      accumulationSamples: settings.accumulationSamples,
      onProgress: setBakeProgress,
    })
    setBakeProgress(88, 'Base IVOL payload ready. Baking detail volume.')
    const detailResult = await bakeIrradianceVolumeWebGPU({
      engine: app.engine,
      bounds: detailBounds,
      resolution: detailResolution,
      lights: enabledLights.map((runtime) => runtime.light),
      geometry: app.importedMeshes,
      exposure: settings.exposure,
      bounces: settings.bounces,
      areaSamples: settings.areaSamples,
      bounceRayCount: settings.bounceRayCount,
      accumulationSamples: settings.accumulationSamples,
      onProgress: (percent, message) => {
        setBakeProgress(88 + percent * 0.08, `Detail volume: ${message}`)
      },
    })
    setBakeProgress(96, 'Base and detail IVOL payloads ready.')
    latestBinary = result.binary
    latestDetailBinary = detailResult.binary
    setBakeProgress(96, 'Baking paired static shadowmask.')
    latestShadowMaskBinary = await bakePairedShadowMask(app, bounds, enabledLights.map((runtime) => runtime.config))
    latestBundleBinary = createIrradianceBakeBundle(
      latestBinary,
      latestDetailBinary,
      latestShadowMaskBinary,
    )
    hasGeneratedBake = true

    const parsedBundle = parseIrradianceBakeBundle(latestBundleBinary)
    const parsed = parsedBundle.baseVolume
    setBakeProgress(98, 'Building debug probe preview.')
    createBinaryProbeMeshes(parsed)
    setStatus(`WebGPU bake complete: ${binaryVolumeSummary(parsed)}`)
    volumeState.textContent = 'Ready to download .ivpack'
    summaryLine.textContent =
      `Generated ${irradianceBakeBundleSummary(parsedBundle)} from ${enabledLights.length} light(s) at ${new Date().toLocaleTimeString()}. ${irradianceBakeBundleQualitySummary(parsedBundle)}.`
    if (actualProbeCount < requestedProbeCount) {
      summaryLine.textContent += ` Requested ${requestedResolution.join(' x ')} was budgeted to ${resolution.join(' x ')}.`
    }
    downloadButton.disabled = false
    autoDownloadLatestBake()
    setBakeProgress(100, 'Bake complete. The .ivpack asset was downloaded automatically.')
  } catch (error) {
    setStatus(`WebGPU bake failed: ${(error as Error).message}`, true)
    setBakeProgress(0, 'Bake failed.')
  } finally {
    bakeButton.disabled = false
  }
}

async function bakePairedShadowMask(
  app: Pick<Awaited<ReturnType<typeof createSponzaApp>>, 'scene' | 'importedMeshes'>,
  bounds: IrradianceVolumeData['bounds'],
  enabledLights: BakeLightConfig[],
): Promise<ArrayBuffer> {
  const start = performance.now()
  const binary = await bakeStaticShadowMask({
    scene: app.scene,
    bounds,
    geometry: app.importedMeshes,
    lights: enabledLights,
    resolution: settings.shadowMaskResolution,
    onProgress: (percent, message) => {
      setBakeProgress(96 + percent * 0.02, message)
    },
  })
  const elapsed = ((performance.now() - start) / 1000).toFixed(1)

  setStatus(`Static shadowmask baked in ${elapsed}s.`)

  return binary
}

function createBoundsMesh(bounds: IrradianceVolumeData['bounds']): void {
  if (!activeScene) {
    return
  }

  const min = new Vector3(bounds.min[0], bounds.min[1], bounds.min[2])
  const max = new Vector3(bounds.max[0], bounds.max[1], bounds.max[2])
  const size = max.subtract(min)
  const center = min.add(size.scale(0.5))

  boundsMesh = MeshBuilder.CreateBox('irradiance-volume-bounds', {
    width: size.x,
    height: size.y,
    depth: size.z,
  }, activeScene)
  boundsMesh.position.copyFrom(center)
  boundsMesh.isPickable = false

  const material = new StandardMaterial('irradiance-volume-bounds-material', activeScene)
  material.diffuseColor = new Color3(0.2, 0.92, 0.68)
  material.emissiveColor = new Color3(0.06, 0.35, 0.24)
  material.alpha = 0.22
  material.wireframe = true
  boundsMesh.material = material
}

function createBakeLights(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  if (!activeScene) {
    return
  }

  disposeBakeLights()

  for (let index = 0; index < lightConfigs.length; index += 1) {
    const config = lightConfigs[index]
    const light = index === 0 ? app.bakeLight : createPhysicalPointLight(config)
    const runtime = createLightRuntime(config, light)

    lightRuntimes.push(runtime)
    syncRuntimeFromConfig(runtime)
  }

  lightGizmo = new GizmoManager(activeScene, 1.2)
  lightGizmo.positionGizmoEnabled = true
  lightGizmo.rotationGizmoEnabled = false
  lightGizmo.scaleGizmoEnabled = false
  lightGizmo.boundingBoxGizmoEnabled = false
  lightGizmo.usePointerToAttachGizmos = false
  lightGizmo.clearGizmoOnEmptyPointerEvent = false
  lightGizmo.scaleRatio = 1.35
  lightGizmo.gizmos.positionGizmo?.onDragObservable.add(() => {
    syncSelectedLightFromGizmo()
    markBakeDirty()
  })
  attachGizmoToSelectedLight()
}

function createPhysicalPointLight(config: BakeLightConfig): PointLight {
  if (!activeScene) {
    throw new Error('Cannot create bake light before the Babylon scene is ready.')
  }

  const light = new PointLight(config.name, new Vector3(config.x, config.y, config.z), activeScene)
  light.intensityMode = LightConstants.INTENSITYMODE_LUMINOUSINTENSITY
  light.falloffType = LightConstants.FALLOFF_PHYSICAL

  return light
}

function createLightRuntime(config: BakeLightConfig, light: PointLight): BakeLightRuntime {
  if (!activeScene) {
    throw new Error('Cannot create bake light debug meshes before the Babylon scene is ready.')
  }

  light.name = config.name

  const marker = MeshBuilder.CreateSphere(
    `bake-point-light-marker-${config.id}`,
    { diameter: 0.42, segments: 24 },
    activeScene,
  )
  marker.isPickable = false

  const radiusMesh = MeshBuilder.CreateSphere(
    `bake-point-light-radius-${config.id}`,
    { diameter: 2, segments: 32 },
    activeScene,
  )
  radiusMesh.isPickable = false

  const markerMaterial = new StandardMaterial(`bake-point-light-marker-material-${config.id}`, activeScene)
  markerMaterial.disableLighting = true
  marker.material = markerMaterial

  const radiusMaterial = new StandardMaterial(`bake-point-light-radius-material-${config.id}`, activeScene)
  radiusMaterial.disableLighting = true
  radiusMaterial.wireframe = true
  radiusMaterial.alpha = 0.22
  radiusMesh.material = radiusMaterial

  return {
    config,
    light,
    marker,
    radiusMesh,
    markerMaterial,
    radiusMaterial,
  }
}

function createBakePane(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  pane?.dispose()
  pane = new Pane({
    title: 'Bake Controls',
    container: tweakpaneHost,
  })

  const gridFolder = pane.addFolder({ title: 'Volume Grid' })
  gridFolder.addBinding(settings, 'resolutionX', { label: 'X probes', min: 3, max: 96, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'resolutionY', { label: 'Y probes', min: 2, max: 48, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'resolutionZ', { label: 'Z probes', min: 3, max: 96, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'bounces', { label: 'Bounces', min: 0, max: 16, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'bounceRayCount', { label: 'Bounce rays', min: 1, max: 8, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'areaSamples', { label: 'Area samples', min: 1, max: 8, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'accumulationSamples', { label: 'Accum samples', min: 1, max: 64, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'exposure', { label: 'Exposure', min: 0.2, max: 3, step: 0.05 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'maxProbeCount', { label: 'Probe budget', min: 4096, max: 1048576, step: 16384 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'shadowMaskResolution', {
    label: 'Shadowmask px',
    options: SHADOW_MASK_RESOLUTION_OPTIONS,
  })
    .on('change', () => handleBakeSettingsChanged())

  const lightFolder = pane.addFolder({ title: `Point Lights (${lightConfigs.length}/${MAX_BAKE_LIGHTS})` })
  lightFolder.addBinding(lightSelection, 'selectedLightId', {
    label: 'Selected',
    options: getLightOptions(),
  }).on('change', () => {
    selectLight(Number(lightSelection.selectedLightId))
    createBakePane(app)
  })
  lightFolder.addButton({ title: 'Add point light' }).on('click', () => {
    addBakeLight(app)
  })
  lightFolder.addButton({ title: 'Remove selected' }).on('click', () => {
    removeSelectedBakeLight(app)
  })

  createSelectedLightPane(lightFolder)
}

function createSelectedLightPane(parent: PaneFolder): void {
  const config = getSelectedLightConfig()

  if (!config) {
    return
  }

  const selectedLightFolder = parent.addFolder({ title: config.name })
  selectedLightFolder.addBinding(config, 'enabled', { label: 'Enabled' })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'name', { label: 'Name' })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'x', { label: 'X', min: -20, max: 20, step: 0.1 })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'y', { label: 'Y', min: -2, max: 20, step: 0.1 })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'z', { label: 'Z', min: -20, max: 20, step: 0.1 })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'sourceRadius', { label: 'Source radius', min: 0, max: 6, step: 0.05 })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'range', { label: 'Range', min: 0.5, max: 80, step: 0.25 })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'intensity', { label: 'Intensity cd', min: 0, max: 10000, step: 25 })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'color', { label: 'Color', view: 'color' })
    .on('change', () => handleSelectedLightChanged())
}

function handleBakeSettingsChanged(): void {
  sanitizeBakeSettings()
  pane?.refresh()
  markBakeDirty()
}

function handleSelectedLightChanged(): void {
  const runtime = getSelectedLightRuntime()

  if (!runtime) {
    return
  }

  sanitizeLightConfig(runtime.config)
  syncRuntimeFromConfig(runtime)
  pane?.refresh()
  markBakeDirty()
}

function addBakeLight(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  if (lightConfigs.length >= MAX_BAKE_LIGHTS) {
    setStatus(`Maximum ${MAX_BAKE_LIGHTS} bake lights are supported by the current bundle baker.`, true)

    return
  }

  const selected = getSelectedLightConfig() ?? lightConfigs[lightConfigs.length - 1]
  const config: BakeLightConfig = {
    id: nextLightId,
    name: `Point ${nextLightId}`,
    enabled: true,
    x: selected.x + 1.2,
    y: selected.y,
    z: selected.z + 1.2,
    sourceRadius: selected.sourceRadius,
    range: selected.range,
    intensity: selected.intensity,
    color: selected.color,
  }

  nextLightId += 1
  lightConfigs.push(config)

  const runtime = createLightRuntime(config, createPhysicalPointLight(config))
  lightRuntimes.push(runtime)
  syncRuntimeFromConfig(runtime)
  selectLight(config.id)
  createBakePane(app)
  markBakeDirty()
}

function removeSelectedBakeLight(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  if (lightConfigs.length <= 1) {
    setStatus('Keep at least one point light in the bake set.', true)

    return
  }

  const id = lightSelection.selectedLightId
  const configIndex = lightConfigs.findIndex((config) => config.id === id)
  const runtimeIndex = lightRuntimes.findIndex((runtime) => runtime.config.id === id)

  if (configIndex < 0 || runtimeIndex < 0) {
    return
  }

  const runtime = lightRuntimes[runtimeIndex]
  disposeLightRuntime(runtime)
  lightConfigs.splice(configIndex, 1)
  lightRuntimes.splice(runtimeIndex, 1)
  selectLight(lightConfigs[Math.max(0, configIndex - 1)].id)
  createBakePane(app)
  markBakeDirty()
}

function selectLight(id: number): void {
  lightSelection.selectedLightId = id
  attachGizmoToSelectedLight()
  updateLightDebugSelection()
}

function attachGizmoToSelectedLight(): void {
  const runtime = getSelectedLightRuntime()

  lightGizmo?.attachToMesh(runtime?.marker ?? null)
}

function syncSelectedLightFromGizmo(): void {
  const runtime = getSelectedLightRuntime()

  if (!runtime) {
    return
  }

  runtime.config.x = Number(runtime.marker.position.x.toFixed(2))
  runtime.config.y = Number(runtime.marker.position.y.toFixed(2))
  runtime.config.z = Number(runtime.marker.position.z.toFixed(2))
  syncRuntimeFromConfig(runtime)
  pane?.refresh()
}

function syncAllBakeLights(): void {
  for (const runtime of lightRuntimes) {
    sanitizeLightConfig(runtime.config)
    syncRuntimeFromConfig(runtime)
  }
}

function syncRuntimeFromConfig(runtime: BakeLightRuntime): void {
  const { config, light, marker, radiusMesh, markerMaterial, radiusMaterial } = runtime
  const color = hexToColor3(config.color)

  light.name = config.name
  light.position.set(config.x, config.y, config.z)
  light.diffuse = color
  light.intensity = config.intensity
  light.range = config.range
  light.metadata = {
    ...(typeof light.metadata === 'object' && light.metadata ? light.metadata : {}),
    ivolSourceRadius: config.sourceRadius,
  }
  light.setEnabled(config.enabled)

  marker.position.copyFrom(light.position)
  radiusMesh.position.copyFrom(light.position)
  marker.scaling.setAll(Math.max(0.18, config.sourceRadius))
  radiusMesh.scaling.setAll(config.range)

  markerMaterial.diffuseColor = color
  markerMaterial.emissiveColor = config.enabled ? color : color.scale(0.18)
  markerMaterial.alpha = config.enabled ? 1 : 0.45
  radiusMaterial.diffuseColor = color
  radiusMaterial.emissiveColor = color.scale(0.35)
  updateLightDebugSelection()
}

function updateLightDebugSelection(): void {
  for (const runtime of lightRuntimes) {
    const selected = runtime.config.id === lightSelection.selectedLightId

    runtime.marker.scaling.setAll(Math.max(0.18, runtime.config.sourceRadius) * (selected ? 1.35 : 1))
    runtime.radiusMesh.isVisible = runtime.config.enabled || selected
    runtime.radiusMaterial.alpha = selected ? 0.34 : 0.16
  }
}

function getSelectedLightConfig(): BakeLightConfig | undefined {
  return lightConfigs.find((config) => config.id === lightSelection.selectedLightId)
}

function getSelectedLightRuntime(): BakeLightRuntime | undefined {
  return lightRuntimes.find((runtime) => runtime.config.id === lightSelection.selectedLightId)
}

function getEnabledLightRuntimes(): BakeLightRuntime[] {
  return lightRuntimes.filter((runtime) => runtime.config.enabled).slice(0, MAX_BAKE_LIGHTS)
}

function getLightOptions(): Record<string, number> {
  return Object.fromEntries(lightConfigs.map((config) => [`${config.name} #${config.id}`, config.id]))
}

function disposeBakeLights(): void {
  for (const runtime of lightRuntimes) {
    disposeLightRuntime(runtime)
  }

  lightRuntimes = []
}

function disposeLightRuntime(runtime: BakeLightRuntime): void {
  runtime.marker.dispose()
  runtime.radiusMesh.dispose()
  runtime.markerMaterial.dispose()
  runtime.radiusMaterial.dispose()
  runtime.light.dispose()
}

function markBakeDirty(): void {
  if (!hasGeneratedBake) {
    return
  }

  volumeState.textContent = 'Settings changed'
  setBakeProgress(0, 'Settings changed. Bake again to update the .ivpack asset.')
  downloadButton.disabled = true
}

function createBinaryProbeMeshes(volume: ReturnType<typeof parseIvolBinary>): void {
  if (!activeScene) {
    return
  }

  const probeTotal = volume.payload.length / volume.probeStrideFloats
  const maxPreviewMarkers = 1600
  const stride = Math.max(1, Math.ceil(probeTotal / maxPreviewMarkers))
  const marker = MeshBuilder.CreateSphere(
    'binary-probe-marker-template',
    { diameter: 0.16, segments: 8 },
    activeScene,
  )
  marker.isVisible = false

  for (let z = 0; z < volume.resolution[2]; z += 1) {
    for (let y = 0; y < volume.resolution[1]; y += 1) {
      for (let x = 0; x < volume.resolution[0]; x += 1) {
        const index = probeIndex(x, y, z, volume.resolution)
        if (index % stride !== 0) {
          continue
        }
        const base = index * volume.probeStrideFloats
        const mesh = marker.clone(`binary-probe-marker-${index}`) as Mesh
        const material = new StandardMaterial(`binary-probe-marker-material-${index}`, activeScene)
        const color = new Color3(
          volume.payload[base],
          volume.payload[base + 1],
          volume.payload[base + 2],
        )

        mesh.position.copyFrom(getProbePosition(volume, x, y, z))
        mesh.isPickable = false
        mesh.isVisible = true
        material.disableLighting = true
        material.diffuseColor = color
        material.emissiveColor = color
        mesh.material = material
        probeMeshes.push(mesh)
        probeMaterials.push(material)
      }
    }
  }

  marker.dispose()
}

function disposeProbeMeshes(): void {
  for (const mesh of probeMeshes) {
    mesh.dispose()
  }
  for (const material of probeMaterials) {
    material.dispose()
  }
  probeMeshes = []
  probeMaterials = []
}

function sanitizeBakeSettings(): void {
  settings.resolutionX = clampInteger(settings.resolutionX, 3, 96)
  settings.resolutionY = clampInteger(settings.resolutionY, 2, 48)
  settings.resolutionZ = clampInteger(settings.resolutionZ, 3, 96)
  settings.bounces = clampInteger(settings.bounces, 0, 16)
  settings.bounceRayCount = clampInteger(settings.bounceRayCount, 1, 8)
  settings.areaSamples = clampInteger(settings.areaSamples, 1, 8)
  settings.accumulationSamples = clampInteger(settings.accumulationSamples, 1, 64)
  settings.exposure = clampNumber(settings.exposure, 0.2, 3)
  settings.maxProbeCount = clampInteger(settings.maxProbeCount, 4096, 1048576)
  settings.shadowMaskResolution = getClosestShadowMaskResolution(settings.shadowMaskResolution)
}

function fitResolutionToProbeBudget(resolution: Vec3Tuple, maxProbeCount: number): Vec3Tuple {
  const sanitized: Vec3Tuple = [
    clampInteger(resolution[0], 3, 96),
    clampInteger(resolution[1], 2, 48),
    clampInteger(resolution[2], 3, 96),
  ]
  const requested = sanitized[0] * sanitized[1] * sanitized[2]
  const budget = Math.max(1, Math.floor(maxProbeCount))

  if (requested <= budget) {
    return sanitized
  }

  const scale = Math.cbrt(budget / requested)
  let fitted: Vec3Tuple = [
    Math.max(3, Math.floor(sanitized[0] * scale)),
    Math.max(2, Math.floor(sanitized[1] * scale)),
    Math.max(3, Math.floor(sanitized[2] * scale)),
  ]

  while (fitted[0] * fitted[1] * fitted[2] > budget) {
    const axis = getLargestResolutionAxis(fitted)
    fitted[axis] = Math.max(axis === 1 ? 2 : 3, fitted[axis] - 1)
  }

  return fitted
}

function fitDetailResolutionToProbeBudget(
  requestedResolution: Vec3Tuple,
  sceneBounds: IrradianceVolumeData['bounds'],
  detailBounds: IrradianceVolumeData['bounds'],
  maxProbeCount: number,
): Vec3Tuple {
  const sceneSize = boundsSize(sceneBounds)
  const detailSize = boundsSize(detailBounds)
  const boosted: Vec3Tuple = [
    boostResolutionAxis(requestedResolution[0], sceneSize.x, detailSize.x, 3, 96),
    boostResolutionAxis(requestedResolution[1], sceneSize.y, detailSize.y, 2, 48),
    boostResolutionAxis(requestedResolution[2], sceneSize.z, detailSize.z, 3, 96),
  ]

  return fitResolutionToProbeBudget(boosted, maxProbeCount)
}

function getBaseProbeBudget(): number {
  return Math.max(4096, Math.floor(settings.maxProbeCount * 0.38))
}

function getDetailProbeBudget(): number {
  return Math.max(4096, settings.maxProbeCount - getBaseProbeBudget())
}

function createDetailVolumeBounds(
  bounds: IrradianceVolumeData['bounds'],
  meshes: AbstractMesh[],
): IrradianceVolumeData['bounds'] {
  const min = new Vector3(bounds.min[0], bounds.min[1], bounds.min[2])
  const max = new Vector3(bounds.max[0], bounds.max[1], bounds.max[2])
  const size = max.subtract(min)
  const geometryBounds = createGeometryDensityBounds(bounds, meshes)

  if (geometryBounds) {
    return geometryBounds
  }

  const horizontalInset = Math.min(size.x, size.z) * 0.08
  const detailMin = new Vector3(min.x + horizontalInset, min.y, min.z + horizontalInset)
  const detailMax = new Vector3(max.x - horizontalInset, min.y + Math.max(size.y * 0.58, 2.5), max.z - horizontalInset)

  return {
    min: vector3ToTuple(detailMin),
    max: vector3ToTuple(detailMax),
  }
}

function createGeometryDensityBounds(
  bounds: IrradianceVolumeData['bounds'],
  meshes: AbstractMesh[],
): IrradianceVolumeData['bounds'] | null {
  const sceneMin = new Vector3(bounds.min[0], bounds.min[1], bounds.min[2])
  const sceneMax = new Vector3(bounds.max[0], bounds.max[1], bounds.max[2])
  const sceneSize = sceneMax.subtract(sceneMin)
  const densityMin = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const densityMax = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  const yLimit = sceneMin.y + sceneSize.y * 0.72
  let included = 0

  for (const mesh of meshes) {
    if (!mesh.isEnabled() || !mesh.getTotalVertices()) {
      continue
    }

    const box = mesh.getBoundingInfo().boundingBox
    const meshMin = box.minimumWorld
    const meshMax = box.maximumWorld
    const meshSize = meshMax.subtract(meshMin)
    const centerY = (meshMin.y + meshMax.y) * 0.5
    const diagonal = meshSize.length()

    if (diagonal < 0.08 || centerY > yLimit) {
      continue
    }

    densityMin.minimizeInPlace(meshMin)
    densityMax.maximizeInPlace(meshMax)
    included += 1
  }

  if (included === 0 || !Number.isFinite(densityMin.x) || !Number.isFinite(densityMax.x)) {
    return null
  }

  const densitySize = densityMax.subtract(densityMin)
  const horizontalPadding = Math.max(Math.min(densitySize.x, densitySize.z) * 0.12, Math.min(sceneSize.x, sceneSize.z) * 0.025)
  const verticalPadding = Math.max(densitySize.y * 0.18, sceneSize.y * 0.04)
  const detailMin = new Vector3(
    clampNumber(densityMin.x - horizontalPadding, sceneMin.x, sceneMax.x),
    clampNumber(densityMin.y - verticalPadding, sceneMin.y, sceneMax.y),
    clampNumber(densityMin.z - horizontalPadding, sceneMin.z, sceneMax.z),
  )
  const detailMax = new Vector3(
    clampNumber(densityMax.x + horizontalPadding, sceneMin.x, sceneMax.x),
    clampNumber(Math.min(densityMax.y + verticalPadding, sceneMin.y + sceneSize.y * 0.82), sceneMin.y, sceneMax.y),
    clampNumber(densityMax.z + horizontalPadding, sceneMin.z, sceneMax.z),
  )

  ensureMinimumBoundsSize(detailMin, detailMax, sceneMin, sceneMax)

  return {
    min: vector3ToTuple(detailMin),
    max: vector3ToTuple(detailMax),
  }
}

function ensureMinimumBoundsSize(min: Vector3, max: Vector3, sceneMin: Vector3, sceneMax: Vector3): void {
  const minimumSize = new Vector3(2.5, 1.5, 2.5)

  for (const axis of ['x', 'y', 'z'] as const) {
    const size = max[axis] - min[axis]
    if (size >= minimumSize[axis]) {
      continue
    }

    const center = (min[axis] + max[axis]) * 0.5
    min[axis] = clampNumber(center - minimumSize[axis] * 0.5, sceneMin[axis], sceneMax[axis])
    max[axis] = clampNumber(center + minimumSize[axis] * 0.5, sceneMin[axis], sceneMax[axis])
  }
}

function boundsSize(bounds: IrradianceVolumeData['bounds']): Vector3 {
  return new Vector3(
    Math.max(0.001, bounds.max[0] - bounds.min[0]),
    Math.max(0.001, bounds.max[1] - bounds.min[1]),
    Math.max(0.001, bounds.max[2] - bounds.min[2]),
  )
}

function boostResolutionAxis(value: number, sceneSize: number, detailSize: number, min: number, max: number): number {
  const densityBoost = Math.sqrt(Math.max(1, sceneSize / Math.max(detailSize, 0.001)))

  return clampInteger(Math.round(value * Math.min(densityBoost, 1.85)), min, max)
}

function getLargestResolutionAxis(resolution: Vec3Tuple): 0 | 1 | 2 {
  if (resolution[1] >= resolution[0] && resolution[1] >= resolution[2]) {
    return 1
  }

  return resolution[0] >= resolution[2] ? 0 : 2
}

function getClosestShadowMaskResolution(value: number): number {
  const requested = Number.isFinite(value) ? value : SHADOW_MASK_RESOLUTIONS[0]

  return SHADOW_MASK_RESOLUTIONS.reduce((closest, candidate) => {
    const closestDistance = Math.abs(closest - requested)
    const candidateDistance = Math.abs(candidate - requested)

    return candidateDistance < closestDistance ? candidate : closest
  }, SHADOW_MASK_RESOLUTIONS[0])
}

function sanitizeLightConfig(config: BakeLightConfig): void {
  config.name = config.name.trim() || `Point ${config.id}`
  config.x = clampNumber(config.x, -20, 20)
  config.y = clampNumber(config.y, -2, 20)
  config.z = clampNumber(config.z, -20, 20)
  config.sourceRadius = clampNumber(config.sourceRadius, 0, 6)
  config.range = clampNumber(config.range, 0.5, 80)
  config.intensity = clampNumber(config.intensity, 0, 10000)
  config.color = normalizeHexColor(config.color)
}

function hexToColor3(hex: string): Color3 {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)

  if (!Number.isFinite(value) || normalized.length !== 6) {
    return new Color3(1, 0.72, 0.42)
  }

  return new Color3(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  )
}

function downloadBundle(buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.href = url
  link.download = 'sponza-irradiance-bake.ivpack'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function autoDownloadLatestBake(): void {
  if (latestBundleBinary) {
    downloadBundle(latestBundleBinary)
  }
}

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }

  return element
}

function clampNumber(value: number, min: number, max: number): number {
  const safeValue = Number.isFinite(value) ? value : min

  return Math.min(max, Math.max(min, safeValue))
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max))
}

function normalizeHexColor(hex: string): string {
  const normalized = hex.trim()

  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : '#d9aa63'
}
