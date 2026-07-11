import './style.css'
import '@babylonjs/core/Culling/ray'
import '@babylonjs/core/ShadersWGSL/color.vertex'
import '@babylonjs/core/ShadersWGSL/color.fragment'

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Light } from '@babylonjs/core/Lights/light'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh'
import { Scene } from '@babylonjs/core/scene'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { lightUboDeclarationWGSL } from '@babylonjs/core/ShadersWGSL/ShadersInclude/lightUboDeclaration'
import { lightVxUboDeclarationWGSL } from '@babylonjs/core/ShadersWGSL/ShadersInclude/lightVxUboDeclaration'
import { lightFragmentWGSL } from '@babylonjs/core/ShadersWGSL/ShadersInclude/lightFragment'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { LightConstants } from '@babylonjs/core/Lights/lightConstants'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { RectAreaLight } from '@babylonjs/core/Lights/rectAreaLight'
import { SpotLight } from '@babylonjs/core/Lights/spotLight'
import { Pane } from 'tweakpane'

import type { IrradianceVolumeGrid, Vec3Tuple } from './irradianceVolume'
import {
  binaryVolumeSummary,
  getProbePosition,
  parseIvolBinary,
  probeIndex,
  vector3ToTuple,
} from './irradianceVolume'
import type { BakeLightConfig, BakeLightType } from './defaultBakeLights'
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

type BakeSettings = {
  adaptiveResolution: boolean
  voxelsPerUnit: number
  resolutionX: number
  resolutionY: number
  resolutionZ: number
  denoise: boolean
  dilateInvalidProbes: boolean
  dilationIterations: number
  dilationBackfaceBias: number
  relocateProbes: boolean
  pointLightShadows: boolean
  bounces: number
  bounceRayCount: number
  areaSamples: number
  accumulationSamples: number
  exposure: number
  shadows: number
  highlights: number
  previewExposureEv: number
  maxProbeCount: number
  detailVolumeEnabled: boolean
  detailDensityMultiplier: number
}

const settings: BakeSettings = {
  adaptiveResolution: true,
  voxelsPerUnit: 3,
  resolutionX: 16,
  resolutionY: 16,
  resolutionZ: 16,
  denoise: true,
  dilateInvalidProbes: true,
  dilationIterations: 1,
  dilationBackfaceBias: 0.1,
  relocateProbes: true,
  pointLightShadows: true,
  bounces: 2,
  bounceRayCount: 4,
  areaSamples: 2,
  accumulationSamples: 2,
  exposure: 0,
  shadows: 0,
  highlights: 0,
  previewExposureEv: 0,
  maxProbeCount: 262144,
  detailVolumeEnabled: true,
  detailDensityMultiplier: 1.5,
}

if (new URLSearchParams(location.search).has('smoke')) {
  Object.assign(settings, {
    adaptiveResolution: false,
    resolutionX: 8,
    resolutionY: 4,
    resolutionZ: 8,
    denoise: true,
    dilateInvalidProbes: true,
    dilationIterations: 1,
    relocateProbes: true,
    pointLightShadows: true,
    bounces: 0,
    bounceRayCount: 1,
    areaSamples: 1,
    accumulationSamples: 1,
    maxProbeCount: 4096,
    detailVolumeEnabled: false,
  } satisfies Partial<BakeSettings>)
}

type BakeLightRuntime = {
  config: BakeLightConfig
  light: Light
  marker: Mesh
  shapeMesh: LinesMesh | null
  radiusMesh: Mesh
  markerMaterial: StandardMaterial
  radiusMaterial: StandardMaterial
}

type PaneFolder = ReturnType<Pane['addFolder']>

const MAX_BAKE_LIGHTS = 8
const MAX_DETAIL_PROBE_COUNT = 65536
const MAX_DETAIL_TO_BASE_PROBE_RATIO = 0.35
const LOCAL_LIGHT_DETAIL_MERGE_WASTE_RATIO = 1.8

type DetailVolumePlan = {
  bounds: IrradianceVolumeGrid['bounds']
  source: 'localLight' | 'geometry'
  localLightCount: number
  totalLocalLightCount: number
  localLightTypes: Array<'spot' | 'rectArea'>
}

// Babylon 9.12 declares a different WebGPU Light UBO shape for each light
// type. Bake-light type changes can otherwise reuse an effect whose struct no
// longer matches the bound light buffer, so this page gives editable lights a
// single layout that is valid for every supported bake-light type.
const BABYLON_LIGHT_TYPE_FIELDS = `#ifdef SPOTLIGHT{X}
vLightDirection: vec4f,
vLightFalloff: vec4f,
#elif defined(POINTLIGHT{X})
vLightFalloff: vec4f,
#elif defined(HEMILIGHT{X})
vLightGround: vec3f,
#elif defined(CLUSTLIGHT{X})
vSliceData: vec2f,
vSliceRanges: array<vec4f,CLUSTLIGHT_SLICES>,
#endif
#if defined(AREALIGHT{X}) && defined(AREALIGHTUSED) && defined(AREALIGHTSUPPORTED)
vLightWidth: vec4f,
vLightHeight: vec4f,
#endif`
const BAKE_PREVIEW_LIGHT_FIELDS = `vLightDirection: vec4f,
vLightFalloff: vec4f,
vLightGround: vec3f,
vLightWidth: vec4f,
vLightHeight: vec4f,`

for (const declaration of [lightUboDeclarationWGSL, lightVxUboDeclarationWGSL]) {
  const stableShader = declaration.shader.replace(
    BABYLON_LIGHT_TYPE_FIELDS,
    BAKE_PREVIEW_LIGHT_FIELDS,
  )

  if (stableShader === declaration.shader) {
    throw new Error(`Unable to install the stable WebGPU ${declaration.name} layout.`)
  }

  ShaderStore.IncludesShadersStoreWGSL[declaration.name] = stableShader
}

const fixedLightFragmentShader = lightFragmentWGSL.shader.replace(
  // Babylon 9.12's native WGSL StandardMaterial include uses `define` here,
  // which can emit area-light code without declaring the LTC samplers.
  '#elif define(AREALIGHT{X}) && defined(AREALIGHTSUPPORTED)',
  '#elif defined(AREALIGHT{X}) && defined(AREALIGHTUSED) && defined(AREALIGHTSUPPORTED)',
)
if (fixedLightFragmentShader === lightFragmentWGSL.shader) {
  throw new Error('Unable to install the WebGPU StandardMaterial area-light fix.')
}
ShaderStore.IncludesShadersStoreWGSL[lightFragmentWGSL.name] = fixedLightFragmentShader

const LIGHT_TYPE_OPTIONS: Record<string, BakeLightType> = {
  Point: 'point',
  Spot: 'spot',
  Directional: 'directional',
  'Rect Area': 'rectArea',
}
const lightConfigs: BakeLightConfig[] = createDefaultBakeLightConfigs()
const DEFAULT_LIGHT_INTENSITY: Record<BakeLightType, number> = {
  point: 300,
  spot: 300,
  directional: 500,
  rectArea: 300,
}
const lightIntensityHistory = new Map<number, Partial<Record<BakeLightType, number>>>(
  lightConfigs.map((config) => [config.id, { [config.type]: config.intensity }]),
)
const lightSelection = {
  selectedLightId: lightConfigs[0].id,
}
let nextLightId = 6

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
            asset. WebGPU mode jointly bakes adjustable Babylon physical Point, Spot,
            Directional, and Rect Area lights into a compact .ivpack bundle using the
            same L0/L1 layout as VRCLightVolumes.
            The compact detail volume automatically increases density around active
            Spot and Rect Area lights, and falls back to scene geometry when no local
            high-gradient light region is available.
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
            <li id="estimateLine">Volume estimate is not available yet.</li>
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
const estimateLine = mustQuery<HTMLLIElement>('#estimateLine')
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
let latestBundleBinary: ArrayBuffer | null = null
let probeMeshes: Mesh[] = []
let probeMaterials: StandardMaterial[] = []
let boundsMesh: Mesh | null = null
let lightRuntimes: BakeLightRuntime[] = []
let lightGizmo: GizmoManager | null = null
let pane: Pane | null = null
let paneRebuildTimer: number | undefined
let activeScene: Scene | null = null
let activeVolumeBounds: IrradianceVolumeGrid['bounds'] | null = null
let activeGeometry: AbstractMesh[] = []
let hasGeneratedBake = false

try {
  const app = await createSponzaApp(canvas, setStatus, true, true)
  activeScene = app.scene
  const volumeBounds = volumeBoundsFromScene(app.bounds)
  activeVolumeBounds = volumeBounds
  activeGeometry = app.importedMeshes
  configureBakePreviewLightLimit(app.scene)
  createBoundsMesh(volumeBounds)
  createBakeLights(app)
  configureBakeHdrPreview(app.scene)
  createBakePane(app)
  updateBakeEstimate()
  setBakeProgress(0, 'Waiting for bake.')

  const renderFrame = (): void => {
    try {
      if (lightGizmo?.isDragging) {
        syncSelectedLightFromGizmo()
      }
      app.scene.imageProcessingConfiguration.exposure = 2 ** settings.previewExposureEv
      app.scene.render()
    } catch (error) {
      app.engine.stopRenderLoop(renderFrame)
      setStatus(`WebGPU preview render failed: ${(error as Error).message}`, true)
    }
  }

  app.engine.runRenderLoop(renderFrame)

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
    if (paneRebuildTimer !== undefined) {
      window.clearTimeout(paneRebuildTimer)
    }
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
  bounds: IrradianceVolumeGrid['bounds'],
): Promise<void> {
  sanitizeBakeSettings()
  syncAllBakeLights()
  bakeButton.disabled = true
  downloadButton.disabled = true
  latestBundleBinary = null
  latestBinary = null
  latestDetailBinary = null
  disposeProbeMeshes()
  const enabledLights = getEnabledLightRuntimes()

  const resolution = calculateVolumeResolution(bounds)
  const actualProbeCount = resolution[0] * resolution[1] * resolution[2]
  const detailPlan = settings.detailVolumeEnabled
    ? createDetailVolumePlan(
      bounds,
      app.importedMeshes,
      resolution,
      enabledLights.map((runtime) => runtime.config),
    )
    : null
  const detailBounds = detailPlan?.bounds ?? null
  const detailResolution = detailBounds
    ? calculateDetailVolumeResolution(bounds, detailBounds, resolution)
    : null
  const detailProbeCount = detailResolution
    ? detailResolution[0] * detailResolution[1] * detailResolution[2]
    : 0

  setStatus('WebGPU baking Babylon physical lights...')
  volumeState.textContent = 'WebGPU baking...'
  probeCount.textContent = detailResolution
    ? `${actualProbeCount} base + ${detailProbeCount} detail probes`
    : `${actualProbeCount} probes`
  setBakeProgress(8, 'Preparing WebGPU buffers.')

  try {
    if (enabledLights.length === 0) {
      throw new Error('Enable at least one physical light before baking.')
    }
    if (actualProbeCount + detailProbeCount > settings.maxProbeCount) {
      throw new Error(
        `Requested ${actualProbeCount + detailProbeCount} probes exceeds the safety budget ${settings.maxProbeCount}. Lower Voxels Per Unit/resolution, disable the detail volume, or raise the budget.`,
      )
    }

    const result = await bakeIrradianceVolumeWebGPU({
      engine: app.engine,
      bounds,
      resolution,
      lights: enabledLights.map((runtime) => runtime.light),
      geometry: app.importedMeshes,
      exposureEv: settings.exposure,
      shadows: settings.shadows,
      highlights: settings.highlights,
      denoise: settings.denoise,
      dilateInvalidProbes: settings.dilateInvalidProbes,
      dilationIterations: settings.dilationIterations,
      dilationBackfaceBias: settings.dilationBackfaceBias,
      relocateProbes: settings.relocateProbes,
      pointLightShadows: settings.pointLightShadows,
      bounces: settings.bounces,
      areaSamples: settings.areaSamples,
      bounceRayCount: settings.bounceRayCount,
      accumulationSamples: settings.accumulationSamples,
      onProgress: (percent, message) => {
        const progressEnd = detailResolution ? 86 : 96
        setBakeProgress(8 + percent * ((progressEnd - 8) / 100), `Base volume: ${message}`)
      },
    })
    const detailResult = detailBounds && detailResolution
      ? await bakeIrradianceVolumeWebGPU({
        engine: app.engine,
        bounds: detailBounds,
        resolution: detailResolution,
        lights: enabledLights.map((runtime) => runtime.light),
        geometry: app.importedMeshes,
        exposureEv: settings.exposure,
        shadows: settings.shadows,
        highlights: settings.highlights,
        denoise: settings.denoise,
        dilateInvalidProbes: settings.dilateInvalidProbes,
        dilationIterations: settings.dilationIterations,
        dilationBackfaceBias: settings.dilationBackfaceBias,
        relocateProbes: settings.relocateProbes,
        pointLightShadows: settings.pointLightShadows,
        bounces: settings.bounces,
        areaSamples: settings.areaSamples,
        bounceRayCount: settings.bounceRayCount,
        accumulationSamples: settings.accumulationSamples,
        onProgress: (percent, message) => {
          setBakeProgress(86 + percent * 0.1, `Detail volume: ${message}`)
        },
      })
      : null
    setBakeProgress(96, detailResult ? 'Base and detail IVOL payloads ready.' : 'IVOL payload ready.')
    latestBinary = result.binary
    latestDetailBinary = detailResult?.binary ?? null
    setBakeProgress(96, 'Packing compact L1 volume bundle.')
    latestBundleBinary = createIrradianceBakeBundle(
      latestBinary,
      latestDetailBinary,
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
    summaryLine.textContent += settings.adaptiveResolution
      ? ` Adaptive density ${settings.voxelsPerUnit.toFixed(2)} voxels/m.`
      : ` Manual resolution ${resolution.join(' x ')}.`
    if (detailResolution && detailPlan?.source === 'localLight') {
      summaryLine.textContent += ` Local-light detail covers ${detailPlan.localLightCount}/${detailPlan.totalLocalLightCount} compact ${formatDetailLightTypes(detailPlan.localLightTypes)} region(s).`
    }
    downloadButton.disabled = false
    setBakeProgress(100, 'Bake complete. Review the summary, then download the .ivpack asset.')
  } catch (error) {
    setStatus(`WebGPU bake failed: ${(error as Error).message}`, true)
    volumeState.textContent = 'Bake failed'
    downloadButton.disabled = true
    setBakeProgress(0, 'Bake failed.')
  } finally {
    bakeButton.disabled = false
  }
}

function createBoundsMesh(bounds: IrradianceVolumeGrid['bounds']): void {
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

function configureBakePreviewLightLimit(scene: Scene): void {
  const configureMaterial = (material: Material): void => {
    if ('maxSimultaneousLights' in material) {
      (material as typeof material & { maxSimultaneousLights: number }).maxSimultaneousLights = MAX_BAKE_LIGHTS
    }
  }

  for (const material of scene.materials) {
    configureMaterial(material)
  }

  scene.onNewMaterialAddedObservable.add(configureMaterial)
}

function createBakeLights(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  if (!activeScene) {
    return
  }

  disposeBakeLights()
  installBakePreviewLightUniformLayout(app.bakeLight)
  app.bakeLight.setEnabled(false)
  app.bakeLight.intensity = 0

  for (const config of lightConfigs) {
    const runtime = createLightRuntime(config, createPhysicalLight(config))

    lightRuntimes.push(runtime)
    syncRuntimeFromConfig(runtime)
  }

  lightGizmo = new GizmoManager(activeScene, 1.2)
  lightGizmo.positionGizmoEnabled = true
  lightGizmo.rotationGizmoEnabled = true
  lightGizmo.scaleGizmoEnabled = true
  lightGizmo.boundingBoxGizmoEnabled = false
  lightGizmo.usePointerToAttachGizmos = false
  installBakePreviewUtilityLightLayouts(lightGizmo)
  lightGizmo.clearGizmoOnEmptyPointerEvent = false
  lightGizmo.scaleRatio = 1.35
  lightGizmo.gizmos.positionGizmo?.onDragObservable.add(() => {
    syncSelectedLightFromGizmo()
    markBakeDirty()
  })
  lightGizmo.gizmos.rotationGizmo?.onDragObservable.add(() => {
    syncSelectedLightFromGizmo()
    markBakeDirty()
  })
  if (lightGizmo.gizmos.scaleGizmo) {
    lightGizmo.gizmos.scaleGizmo.zGizmo.isEnabled = false
    lightGizmo.gizmos.scaleGizmo.uniformScaleGizmo.isEnabled = false
    lightGizmo.gizmos.scaleGizmo.onDragObservable.add(() => {
      markBakeDirty()
    })
    lightGizmo.gizmos.scaleGizmo.onDragEndObservable.add(() => {
      commitSelectedRectAreaScale()
    })
  }
  attachGizmoToSelectedLight()
}

function createPhysicalLight(config: BakeLightConfig): Light {
  if (!activeScene) {
    throw new Error('Cannot create bake light before the Babylon scene is ready.')
  }

  const position = new Vector3(config.x, config.y, config.z)
  const direction = getLightDirection(config)

  if (config.type === 'spot') {
    const light = new SpotLight(
      config.name,
      position,
      direction,
      degreesToRadians(config.outerConeAngle),
      1,
      activeScene,
    )
    light.intensityMode = LightConstants.INTENSITYMODE_LUMINOUSINTENSITY
    light.falloffType = LightConstants.FALLOFF_GLTF

    return light
  }

  if (config.type === 'directional') {
    const light = new DirectionalLight(config.name, direction, activeScene)
    light.intensityMode = LightConstants.INTENSITYMODE_ILLUMINANCE

    return light
  }

  if (config.type === 'rectArea') {
    return new RectAreaLight(config.name, Vector3.Zero(), config.width, config.height, activeScene)
  }

  const light = new PointLight(config.name, position, activeScene)
  light.intensityMode = LightConstants.INTENSITYMODE_LUMINOUSINTENSITY
  light.falloffType = LightConstants.FALLOFF_PHYSICAL

  return light
}

function createLightRuntime(config: BakeLightConfig, light: Light): BakeLightRuntime {
  if (!activeScene) {
    throw new Error('Cannot create bake light debug meshes before the Babylon scene is ready.')
  }

  light.name = config.name
  installBakePreviewLightUniformLayout(light)

  const marker = MeshBuilder.CreateSphere(
    `bake-point-light-marker-${config.id}`,
    { diameter: 0.42, segments: 24 },
    activeScene,
  )
  marker.isPickable = false
  marker.rotationQuaternion = Quaternion.Identity()

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

  const shapeMesh = createLightShapeMesh(config, marker)

  if (light instanceof RectAreaLight) {
    light.parent = marker
  }

  return {
    config,
    light,
    marker,
    shapeMesh,
    radiusMesh,
    markerMaterial,
    radiusMaterial,
  }
}

function createLightShapeMesh(config: BakeLightConfig, marker: Mesh): LinesMesh | null {
  if (!activeScene || config.type === 'point') {
    return null
  }

  const shapeMesh = MeshBuilder.CreateLineSystem(
    `bake-light-shape-${config.id}`,
    {
      lines: createLightShapeLines(config),
      updatable: true,
    },
    activeScene,
  )
  shapeMesh.parent = marker
  shapeMesh.isPickable = false

  return shapeMesh
}

function createLightShapeLines(config: BakeLightConfig): Vector3[][] {
  if (config.type === 'spot') {
    return createSpotLightShapeLines(config)
  }
  if (config.type === 'directional') {
    return createDirectionalLightShapeLines()
  }
  if (config.type === 'rectArea') {
    return createRectAreaLightShapeLines(config)
  }

  return []
}

function createSpotLightShapeLines(config: BakeLightConfig): Vector3[][] {
  const segmentCount = 24
  const range = Math.max(0.001, config.range)
  const outerRadius = Math.tan(degreesToRadians(config.outerConeAngle * 0.5)) * range
  const innerRadius = Math.tan(degreesToRadians(config.innerConeAngle * 0.5)) * range
  const createRing = (radius: number): Vector3[] => {
    const points: Vector3[] = []
    for (let index = 0; index <= segmentCount; index += 1) {
      const angle = index / segmentCount * Math.PI * 2
      points.push(new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, -range))
    }

    return points
  }
  const lines: Vector3[][] = [createRing(outerRadius), createRing(innerRadius)]

  for (let index = 0; index < segmentCount; index += segmentCount / 4) {
    const angle = index / segmentCount * Math.PI * 2
    lines.push([
      Vector3.Zero(),
      new Vector3(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius, -range),
    ])
  }
  lines.push([Vector3.Zero(), new Vector3(0, 0, -range)])

  return lines
}

function createDirectionalLightShapeLines(): Vector3[][] {
  const lines: Vector3[][] = []
  for (const x of [-0.45, 0, 0.45]) {
    const tip = new Vector3(x, 0, -0.9)
    lines.push([new Vector3(x, 0, 0.7), tip])
    lines.push([tip, new Vector3(x - 0.12, 0, -0.68)])
    lines.push([tip, new Vector3(x + 0.12, 0, -0.68)])
    lines.push([tip, new Vector3(x, 0.12, -0.68)])
    lines.push([tip, new Vector3(x, -0.12, -0.68)])
  }

  return lines
}

function createRectAreaLightShapeLines(config: BakeLightConfig): Vector3[][] {
  const halfWidth = config.width * 0.5
  const halfHeight = config.height * 0.5
  const corners = [
    new Vector3(-halfWidth, -halfHeight, 0),
    new Vector3(halfWidth, -halfHeight, 0),
    new Vector3(halfWidth, halfHeight, 0),
    new Vector3(-halfWidth, halfHeight, 0),
    new Vector3(-halfWidth, -halfHeight, 0),
  ]
  const arrowLength = clampNumber(Math.max(config.width, config.height) * 0.45, 0.5, 3)
  const arrowHeadSize = Math.min(0.22, arrowLength * 0.3)
  const tip = new Vector3(0, 0, -arrowLength)
  const headZ = -arrowLength + arrowHeadSize

  return [
    corners,
    [Vector3.Zero(), tip],
    [tip, new Vector3(arrowHeadSize, 0, headZ)],
    [tip, new Vector3(-arrowHeadSize, 0, headZ)],
    [tip, new Vector3(0, arrowHeadSize, headZ)],
    [tip, new Vector3(0, -arrowHeadSize, headZ)],
  ]
}

function getDirectionalControlPosition(): Vector3 {
  if (!activeVolumeBounds) {
    return Vector3.Zero()
  }

  return new Vector3(
    (activeVolumeBounds.min[0] + activeVolumeBounds.max[0]) * 0.5,
    (activeVolumeBounds.min[1] + activeVolumeBounds.max[1]) * 0.5,
    (activeVolumeBounds.min[2] + activeVolumeBounds.max[2]) * 0.5,
  )
}

type LightWithUniformBuffer = Light & {
  _uniformBuffer: UniformBuffer
}

function installBakePreviewLightUniformLayout(light: Light): void {
  const internalLight = light as LightWithUniformBuffer
  internalLight._uniformBuffer.dispose()

  const buffer = new UniformBuffer(
    light.getScene().getEngine(),
    undefined,
    undefined,
    `${light.name}-bake-preview-light`,
  )
  buffer.addUniform('vLightData', 4)
  buffer.addUniform('vLightDiffuse', 4)
  buffer.addUniform('vLightSpecular', 4)
  buffer.addUniform('vLightDirection', 3)
  buffer.addUniform('vLightFalloff', 4)
  buffer.addUniform('vLightGround', 3)
  buffer.addUniform('vLightWidth', 4)
  buffer.addUniform('vLightHeight', 4)
  buffer.addUniform('shadowsInfo', 3)
  buffer.addUniform('depthValues', 2)
  buffer.create()

  internalLight._uniformBuffer = buffer
}

function installBakePreviewUtilityLightLayouts(gizmoManager: GizmoManager): void {
  const utilityScenes = new Set([
    gizmoManager.utilityLayer.utilityLayerScene,
    gizmoManager.keepDepthUtilityLayer.utilityLayerScene,
  ])

  for (const utilityScene of utilityScenes) {
    for (const light of utilityScene.lights) {
      installBakePreviewLightUniformLayout(light)
    }
  }
}

function createBakePane(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  pane?.dispose()
  pane = new Pane({
    title: 'Bake Controls',
    container: tweakpaneHost,
  })

  const gridFolder = pane.addFolder({ title: 'Light Volume' })
  gridFolder.addBinding(settings, 'adaptiveResolution', { label: 'Adaptive resolution' })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'voxelsPerUnit', { label: 'Voxels per meter', min: 0.25, max: 8, step: 0.25 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'resolutionX', { label: 'Manual X', min: 2, max: 96, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'resolutionY', { label: 'Manual Y', min: 2, max: 48, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'resolutionZ', { label: 'Manual Z', min: 2, max: 96, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'detailVolumeEnabled', { label: 'Local-light detail volume' })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'detailDensityMultiplier', { label: 'Detail density multiplier', min: 1, max: 3, step: 0.25 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'maxProbeCount', { label: 'Safety probe budget', min: 4096, max: 1048576, step: 4096 })
    .on('change', () => handleBakeSettingsChanged())

  const probeFolder = pane.addFolder({ title: 'Probe Processing' })
  probeFolder.addBinding(settings, 'denoise', { label: 'Denoise' })
    .on('change', () => handleBakeSettingsChanged())
  probeFolder.addBinding(settings, 'dilateInvalidProbes', { label: 'Dilate invalid probes' })
    .on('change', () => handleBakeSettingsChanged())
  probeFolder.addBinding(settings, 'dilationIterations', { label: 'Dilation iterations', min: 1, max: 8, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  probeFolder.addBinding(settings, 'dilationBackfaceBias', { label: 'Backface bias', min: 0, max: 1, step: 0.01 })
    .on('change', () => handleBakeSettingsChanged())
  probeFolder.addBinding(settings, 'relocateProbes', { label: 'Relocate probes' })
    .on('change', () => handleBakeSettingsChanged())

  const qualityFolder = pane.addFolder({ title: 'WebGPU Trace Quality' })
  qualityFolder.addBinding(settings, 'pointLightShadows', { label: 'Ray-traced shadows' })
    .on('change', () => handleBakeSettingsChanged())
  qualityFolder.addBinding(settings, 'bounces', { label: 'Indirect bounces', min: 0, max: 16, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  qualityFolder.addBinding(settings, 'bounceRayCount', { label: 'Bounce rays', min: 1, max: 8, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  qualityFolder.addBinding(settings, 'areaSamples', { label: 'Soft shadow samples', min: 1, max: 8, step: 1 })
    .on('change', () => handleBakeSettingsChanged())
  qualityFolder.addBinding(settings, 'accumulationSamples', { label: 'Accumulation samples', min: 1, max: 64, step: 1 })
    .on('change', () => handleBakeSettingsChanged())

  const colorFolder = pane.addFolder({ title: 'Color Correction' })
  colorFolder.addBinding(settings, 'exposure', { label: 'Exposure EV', min: -8, max: 8, step: 0.25 })
    .on('change', () => handleBakeSettingsChanged())
  colorFolder.addBinding(settings, 'shadows', { label: 'Shadows', min: -1, max: 1, step: 0.05 })
    .on('change', () => handleBakeSettingsChanged())
  colorFolder.addBinding(settings, 'highlights', { label: 'Highlights', min: -1, max: 1, step: 0.05 })
    .on('change', () => handleBakeSettingsChanged())

  const displayFolder = pane.addFolder({ title: 'HDR Preview' })
  displayFolder.addBinding(settings, 'previewExposureEv', { label: 'Display exposure EV', min: -4, max: 4, step: 0.25 })
    .on('change', () => {
      settings.previewExposureEv = clampNumber(settings.previewExposureEv, -4, 4)
      pane?.refresh()
    })

  const lightFolder = pane.addFolder({ title: `Physical Lights (${lightConfigs.length}/${MAX_BAKE_LIGHTS})` })
  lightFolder.addBinding(lightSelection, 'selectedLightId', {
    label: 'Selected',
    options: getLightOptions(),
  }).on('change', () => {
    selectLight(Number(lightSelection.selectedLightId))
    scheduleBakePaneRebuild(app)
  })
  lightFolder.addButton({ title: 'Add light' }).on('click', () => {
    addBakeLight(app)
  })
  lightFolder.addButton({ title: 'Remove selected' }).on('click', () => {
    removeSelectedBakeLight(app)
  })

  createSelectedLightPane(lightFolder, app)
}

function createSelectedLightPane(
  parent: PaneFolder,
  app: Awaited<ReturnType<typeof createSponzaApp>>,
): void {
  const config = getSelectedLightConfig()

  if (!config) {
    return
  }

  const selectedLightFolder = parent.addFolder({ title: config.name })
  selectedLightFolder.addBinding(config, 'enabled', { label: 'Enabled' })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'name', { label: 'Name' })
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'type', {
    label: 'Light type',
    options: LIGHT_TYPE_OPTIONS,
  }).on('change', () => handleSelectedLightTypeChanged(app))

  if (config.type !== 'directional') {
    selectedLightFolder.addBinding(config, 'x', { label: 'X', min: -20, max: 20, step: 0.1 })
      .on('change', () => handleSelectedLightChanged())
    selectedLightFolder.addBinding(config, 'y', { label: 'Y', min: -2, max: 20, step: 0.1 })
      .on('change', () => handleSelectedLightChanged())
    selectedLightFolder.addBinding(config, 'z', { label: 'Z', min: -20, max: 20, step: 0.1 })
      .on('change', () => handleSelectedLightChanged())
  }

  if (config.type !== 'point') {
    selectedLightFolder.addBinding(config, 'rotationX', { label: 'Rotation X', min: -180, max: 180, step: 1 })
      .on('change', () => handleSelectedLightChanged())
    selectedLightFolder.addBinding(config, 'rotationY', { label: 'Rotation Y', min: -180, max: 180, step: 1 })
      .on('change', () => handleSelectedLightChanged())
    selectedLightFolder.addBinding(config, 'rotationZ', { label: 'Rotation Z', min: -180, max: 180, step: 1 })
      .on('change', () => handleSelectedLightChanged())
  }

  if (config.type === 'point' || config.type === 'spot') {
    selectedLightFolder.addBinding(config, 'sourceRadius', { label: 'Source radius', min: 0, max: 6, step: 0.05 })
      .on('change', () => handleSelectedLightChanged())
  }

  if (config.type === 'point' || config.type === 'spot') {
    selectedLightFolder.addBinding(config, 'range', { label: 'Range', min: 0.5, max: 80, step: 0.25 })
      .on('change', () => handleSelectedLightChanged())
  }

  if (config.type === 'spot') {
    selectedLightFolder.addBinding(config, 'innerConeAngle', { label: 'Inner cone', min: 0, max: 178, step: 1 })
      .on('change', () => handleSelectedLightChanged())
    selectedLightFolder.addBinding(config, 'outerConeAngle', { label: 'Outer cone', min: 1, max: 179, step: 1 })
      .on('change', () => handleSelectedLightChanged())
  } else if (config.type === 'directional') {
    selectedLightFolder.addBinding(config, 'angularRadius', { label: 'Angular radius °', min: 0, max: 10, step: 0.01 })
      .on('change', () => handleSelectedLightChanged())
  } else if (config.type === 'rectArea') {
    selectedLightFolder.addBinding(config, 'width', { label: 'Width m', min: 0.05, max: 20, step: 0.05 })
      .on('change', () => handleSelectedLightChanged())
    selectedLightFolder.addBinding(config, 'height', { label: 'Height m', min: 0.05, max: 20, step: 0.05 })
      .on('change', () => handleSelectedLightChanged())
  }

  const intensityOptions = config.type === 'directional'
    ? { label: 'Illuminance lux', min: 0, max: 200000, step: 100 }
    : config.type === 'rectArea'
      ? { label: 'Luminance cd/m²', min: 0, max: 100000, step: 25 }
      : { label: 'Intensity cd', min: 0, max: 10000, step: 25 }
  selectedLightFolder.addBinding(config, 'intensity', intensityOptions)
    .on('change', () => handleSelectedLightChanged())
  selectedLightFolder.addBinding(config, 'color', { label: 'Color', view: 'color' })
    .on('change', () => handleSelectedLightChanged())
}

function handleSelectedLightTypeChanged(
  app: Awaited<ReturnType<typeof createSponzaApp>>,
): void {
  const runtimeIndex = lightRuntimes.findIndex(
    (runtime) => runtime.config.id === lightSelection.selectedLightId,
  )
  const config = getSelectedLightConfig()
  if (runtimeIndex < 0 || !config) {
    return
  }

  const previousType = getRuntimeLightType(lightRuntimes[runtimeIndex].light)
  rememberLightIntensity(config.id, previousType, config.intensity)
  const rememberedIntensity = lightIntensityHistory.get(config.id)?.[config.type]
  if (rememberedIntensity !== undefined) {
    config.intensity = rememberedIntensity
  } else if (getLightIntensityUnit(previousType) !== getLightIntensityUnit(config.type)) {
    config.intensity = DEFAULT_LIGHT_INTENSITY[config.type]
  }

  sanitizeLightConfig(config)
  disposeLightRuntime(lightRuntimes[runtimeIndex])
  const runtime = createLightRuntime(config, createPhysicalLight(config))
  lightRuntimes[runtimeIndex] = runtime
  syncRuntimeFromConfig(runtime)
  rebuildBakePreviewEffects()
  attachGizmoToSelectedLight()
  scheduleBakePaneRebuild(app)
  markBakeDirty()
}

function rebuildBakePreviewEffects(): void {
  if (!activeScene) {
    return
  }

  // Light type changes alter the material defines. The light UBO itself keeps
  // the stable union layout installed by installBakePreviewLightUniformLayout.
  activeScene.markAllMaterialsAsDirty(Material.LightDirtyFlag)
}

function scheduleBakePaneRebuild(
  app: Awaited<ReturnType<typeof createSponzaApp>>,
): void {
  if (paneRebuildTimer !== undefined) {
    window.clearTimeout(paneRebuildTimer)
  }

  paneRebuildTimer = window.setTimeout(() => {
    paneRebuildTimer = undefined
    createBakePane(app)
  }, 0)
}

function handleBakeSettingsChanged(): void {
  sanitizeBakeSettings()
  pane?.refresh()
  updateBakeEstimate()
  markBakeDirty()
}

function handleSelectedLightChanged(): void {
  const runtime = getSelectedLightRuntime()

  if (!runtime) {
    return
  }

  sanitizeLightConfig(runtime.config)
  rememberLightIntensity(runtime.config.id, runtime.config.type, runtime.config.intensity)
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
    name: `Light ${nextLightId}`,
    enabled: true,
    type: selected.type,
    x: selected.x + 1.2,
    y: selected.y,
    z: selected.z + 1.2,
    rotationX: selected.rotationX,
    rotationY: selected.rotationY,
    rotationZ: selected.rotationZ,
    sourceRadius: selected.sourceRadius,
    angularRadius: selected.angularRadius,
    range: selected.range,
    intensity: selected.intensity,
    color: selected.color,
    innerConeAngle: selected.innerConeAngle,
    outerConeAngle: selected.outerConeAngle,
    width: selected.width,
    height: selected.height,
  }

  nextLightId += 1
  lightConfigs.push(config)
  rememberLightIntensity(config.id, config.type, config.intensity)

  const runtime = createLightRuntime(config, createPhysicalLight(config))
  lightRuntimes.push(runtime)
  syncRuntimeFromConfig(runtime)
  rebuildBakePreviewEffects()
  selectLight(config.id)
  scheduleBakePaneRebuild(app)
  markBakeDirty()
}

function removeSelectedBakeLight(app: Awaited<ReturnType<typeof createSponzaApp>>): void {
  if (lightConfigs.length <= 1) {
    setStatus('Keep at least one physical light in the bake set.', true)

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
  lightIntensityHistory.delete(id)
  rebuildBakePreviewEffects()
  selectLight(lightConfigs[Math.max(0, configIndex - 1)].id)
  scheduleBakePaneRebuild(app)
  markBakeDirty()
}

function selectLight(id: number): void {
  lightSelection.selectedLightId = id
  attachGizmoToSelectedLight()
  updateLightDebugSelection()
}

function attachGizmoToSelectedLight(): void {
  const runtime = getSelectedLightRuntime()
  if (!lightGizmo) {
    return
  }

  lightGizmo.attachToMesh(null)
  const marker = runtime?.marker ?? null
  if (lightGizmo.gizmos.positionGizmo) {
    lightGizmo.gizmos.positionGizmo.attachedMesh = runtime?.config.type === 'directional'
      ? null
      : marker
  }
  if (lightGizmo.gizmos.rotationGizmo) {
    lightGizmo.gizmos.rotationGizmo.attachedMesh = runtime?.config.type === 'point'
      ? null
      : marker
  }
  if (lightGizmo.gizmos.scaleGizmo) {
    lightGizmo.gizmos.scaleGizmo.attachedMesh = runtime?.config.type === 'rectArea'
      ? marker
      : null
  }
}

function syncSelectedLightFromGizmo(): void {
  const runtime = getSelectedLightRuntime()

  if (!runtime) {
    return
  }

  if (runtime.config.type !== 'directional') {
    runtime.config.x = Number(runtime.marker.position.x.toFixed(2))
    runtime.config.y = Number(runtime.marker.position.y.toFixed(2))
    runtime.config.z = Number(runtime.marker.position.z.toFixed(2))
  }
  const rotation = runtime.marker.rotationQuaternion?.toEulerAngles() ?? runtime.marker.rotation
  runtime.config.rotationX = Number(radiansToDegrees(rotation.x).toFixed(1))
  runtime.config.rotationY = Number(radiansToDegrees(rotation.y).toFixed(1))
  runtime.config.rotationZ = Number(radiansToDegrees(rotation.z).toFixed(1))
  syncRuntimeFromConfig(runtime)
  pane?.refresh()
}

function commitSelectedRectAreaScale(): void {
  const runtime = getSelectedLightRuntime()
  if (!runtime || runtime.config.type !== 'rectArea') {
    return
  }

  runtime.config.width *= Math.abs(runtime.marker.scaling.x)
  runtime.config.height *= Math.abs(runtime.marker.scaling.y)
  runtime.marker.scaling.setAll(1)
  sanitizeLightConfig(runtime.config)
  syncRuntimeFromConfig(runtime)
  pane?.refresh()
  markBakeDirty()
}

function syncAllBakeLights(): void {
  for (const runtime of lightRuntimes) {
    sanitizeLightConfig(runtime.config)
    syncRuntimeFromConfig(runtime)
  }
}

function syncRuntimeFromConfig(runtime: BakeLightRuntime): void {
  const { config, light, marker, shapeMesh, radiusMesh, markerMaterial, radiusMaterial } = runtime
  const color = hexToColor3(config.color)
  const position = new Vector3(config.x, config.y, config.z)
  const rotation = getLightRotation(config)
  const direction = getLightDirection(config)
  const right = Vector3.Right().applyRotationQuaternion(rotation).normalize()
  const up = Vector3.Up().applyRotationQuaternion(rotation).normalize()

  light.name = config.name
  light.diffuse = color
  light.intensity = config.intensity

  if (light instanceof PointLight) {
    light.position.copyFrom(position)
    light.range = config.range
    light.radius = config.sourceRadius
  } else if (light instanceof SpotLight) {
    light.position.copyFrom(position)
    light.direction.copyFrom(direction)
    light.range = config.range
    light.radius = config.sourceRadius
    light.angle = degreesToRadians(config.outerConeAngle)
    light.innerAngle = degreesToRadians(config.innerConeAngle)
  } else if (light instanceof DirectionalLight) {
    light.direction.copyFrom(direction)
    light.radius = degreesToRadians(config.angularRadius)
  } else if (light instanceof RectAreaLight) {
    light.position.setAll(0)
    light.width = config.width
    light.height = config.height
  }

  light.metadata = {
    ...(typeof light.metadata === 'object' && light.metadata ? light.metadata : {}),
    ivolPosition: [position.x, position.y, position.z],
    ivolDirection: [direction.x, direction.y, direction.z],
    ivolRight: [right.x, right.y, right.z],
    ivolUp: [up.x, up.y, up.z],
    ivolSourceRadius: config.sourceRadius,
    ivolAngularRadius: degreesToRadians(config.angularRadius),
    ivolRange: config.range,
    ivolInnerConeCos: Math.cos(degreesToRadians(config.innerConeAngle * 0.5)),
    ivolOuterConeCos: Math.cos(degreesToRadians(config.outerConeAngle * 0.5)),
    ivolWidth: config.width,
    ivolHeight: config.height,
  }
  light.setEnabled(config.enabled)

  marker.position.copyFrom(config.type === 'directional' ? getDirectionalControlPosition() : position)
  marker.rotationQuaternion = rotation
  radiusMesh.position.copyFrom(position)
  radiusMesh.rotationQuaternion = rotation.clone()
  marker.scaling.setAll(config.type === 'rectArea' ? 1 : Math.max(0.18, config.sourceRadius))
  radiusMesh.scaling.setAll(config.range)

  markerMaterial.diffuseColor = color
  markerMaterial.emissiveColor = config.enabled ? color : color.scale(0.18)
  markerMaterial.alpha = config.enabled ? 1 : 0.45
  radiusMaterial.diffuseColor = color
  radiusMaterial.emissiveColor = color.scale(0.35)
  if (shapeMesh) {
    MeshBuilder.CreateLineSystem(shapeMesh.name, {
      lines: createLightShapeLines(config),
      instance: shapeMesh,
    })
    shapeMesh.color = color
  }
  updateLightDebugSelection()
}

function updateLightDebugSelection(): void {
  for (const runtime of lightRuntimes) {
    const selected = runtime.config.id === lightSelection.selectedLightId

    // RectAreaLight is parented to the marker so it inherits rotation. Keep
    // that marker at unit scale or its authored width/height would be scaled too.
    const markerScale = runtime.config.type === 'point'
      ? Math.max(0.18, runtime.config.sourceRadius) * (selected ? 1.35 : 1)
      : 1
    runtime.marker.scaling.setAll(markerScale)
    runtime.shapeMesh?.setEnabled(selected)
    // Spot and area lights have type-specific helpers. A range sphere is only
    // meaningful for Point lights.
    runtime.radiusMesh.isVisible = selected && runtime.config.type === 'point'
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
  runtime.light.parent = null
  runtime.light.dispose()
  runtime.shapeMesh?.dispose()
  runtime.marker.dispose()
  runtime.radiusMesh.dispose()
  runtime.markerMaterial.dispose()
  runtime.radiusMaterial.dispose()
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

function updateBakeEstimate(): void {
  if (!activeVolumeBounds) {
    return
  }

  const baseResolution = calculateVolumeResolution(activeVolumeBounds)
  const baseCount = baseResolution[0] * baseResolution[1] * baseResolution[2]
  const detailPlan = settings.detailVolumeEnabled
    ? createDetailVolumePlan(
      activeVolumeBounds,
      activeGeometry,
      baseResolution,
      lightConfigs.filter((config) => config.enabled),
    )
    : null
  const detailBounds = detailPlan?.bounds ?? null
  const detailResolution = detailBounds
    ? calculateDetailVolumeResolution(activeVolumeBounds, detailBounds, baseResolution)
    : null
  const detailCount = detailResolution
    ? detailResolution[0] * detailResolution[1] * detailResolution[2]
    : 0
  const totalCount = baseCount + detailCount
  const ivolBytes = totalCount * 12 * Float32Array.BYTES_PER_ELEMENT + (detailResolution ? 2 : 1) * 96
  const scratchBytes = totalCount * 20 * Float32Array.BYTES_PER_ELEMENT
  const mode = settings.adaptiveResolution
    ? `${settings.voxelsPerUnit.toFixed(2)} voxels/m`
    : 'manual'
  const detailSource = detailPlan?.source === 'localLight'
    ? `local-light detail ${detailPlan.localLightCount}/${detailPlan.totalLocalLightCount}`
    : 'detail'
  const detailText = detailResolution ? ` + ${detailSource} ${detailResolution.join(' x ')}` : ''
  const budgetState = totalCount > settings.maxProbeCount
    ? ` Exceeds safety budget by ${totalCount - settings.maxProbeCount} probes.`
    : ''

  estimateLine.textContent = `${mode}: base ${baseResolution.join(' x ')}${detailText}; ${totalCount.toLocaleString()} probes, ${(ivolBytes / 1048576).toFixed(1)} MiB asset payload, ${(scratchBytes / 1048576).toFixed(1)} MiB GPU probe scratch.${budgetState}`
  estimateLine.dataset.state = totalCount > settings.maxProbeCount ? 'error' : 'ready'
}

function sanitizeBakeSettings(): void {
  settings.voxelsPerUnit = clampNumber(settings.voxelsPerUnit, 0.25, 8)
  settings.resolutionX = clampInteger(settings.resolutionX, 2, 96)
  settings.resolutionY = clampInteger(settings.resolutionY, 2, 48)
  settings.resolutionZ = clampInteger(settings.resolutionZ, 2, 96)
  settings.dilationIterations = clampInteger(settings.dilationIterations, 1, 8)
  settings.dilationBackfaceBias = clampNumber(settings.dilationBackfaceBias, 0, 1)
  settings.bounces = clampInteger(settings.bounces, 0, 16)
  settings.bounceRayCount = clampInteger(settings.bounceRayCount, 1, 8)
  settings.areaSamples = clampInteger(settings.areaSamples, 1, 8)
  settings.accumulationSamples = clampInteger(settings.accumulationSamples, 1, 64)
  settings.exposure = clampNumber(settings.exposure, -8, 8)
  settings.shadows = clampNumber(settings.shadows, -1, 1)
  settings.highlights = clampNumber(settings.highlights, -1, 1)
  settings.previewExposureEv = clampNumber(settings.previewExposureEv, -4, 4)
  settings.maxProbeCount = clampInteger(settings.maxProbeCount, 4096, 1048576)
  settings.detailDensityMultiplier = clampNumber(settings.detailDensityMultiplier, 1, 3)
}

function configureBakeHdrPreview(scene: Scene): void {
  const imageProcessing = scene.imageProcessingConfiguration

  imageProcessing.toneMappingEnabled = true
  imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
  imageProcessing.exposure = 2 ** settings.previewExposureEv
  imageProcessing.contrast = 1
  imageProcessing.ditheringEnabled = true
  imageProcessing.ditheringIntensity = 1 / 255
}

function calculateVolumeResolution(
  bounds: IrradianceVolumeGrid['bounds'],
): Vec3Tuple {
  if (settings.adaptiveResolution) {
    return calculateAdaptiveResolution(bounds, settings.voxelsPerUnit)
  }

  return [settings.resolutionX, settings.resolutionY, settings.resolutionZ]
}

function calculateDetailVolumeResolution(
  sceneBounds: IrradianceVolumeGrid['bounds'],
  detailBounds: IrradianceVolumeGrid['bounds'],
  baseResolution: Vec3Tuple,
): Vec3Tuple | null {
  const baseProbeCount = baseResolution[0] * baseResolution[1] * baseResolution[2]
  const remainingProbeBudget = settings.maxProbeCount - baseProbeCount
  const detailProbeBudget = Math.min(
    MAX_DETAIL_PROBE_COUNT,
    Math.floor(baseProbeCount * MAX_DETAIL_TO_BASE_PROBE_RATIO),
    remainingProbeBudget,
  )

  if (detailProbeBudget < 8) {
    return null
  }

  let requestedResolution: Vec3Tuple
  if (settings.adaptiveResolution) {
    requestedResolution = calculateAdaptiveResolution(
      detailBounds,
      settings.voxelsPerUnit * settings.detailDensityMultiplier,
    )
  } else {
    const sceneSize = boundsSize(sceneBounds)
    const detailSize = boundsSize(detailBounds)
    requestedResolution = [
      boostResolutionAxis(baseResolution[0], sceneSize.x, detailSize.x, 2, 96),
      boostResolutionAxis(baseResolution[1], sceneSize.y, detailSize.y, 2, 48),
      boostResolutionAxis(baseResolution[2], sceneSize.z, detailSize.z, 2, 96),
    ]
  }

  return fitResolutionToProbeBudget(requestedResolution, detailProbeBudget)
}

function fitResolutionToProbeBudget(resolution: Vec3Tuple, probeBudget: number): Vec3Tuple {
  const fitted: Vec3Tuple = [...resolution]
  const probeCount = (): number => fitted[0] * fitted[1] * fitted[2]

  if (probeCount() <= probeBudget) {
    return fitted
  }

  const uniformScale = Math.cbrt(probeBudget / probeCount())
  for (let axis = 0; axis < 3; axis += 1) {
    fitted[axis] = Math.max(2, Math.floor(fitted[axis] * uniformScale))
  }

  while (probeCount() > probeBudget) {
    let axisToReduce = -1
    let largestAxis = 0
    for (let axis = 0; axis < 3; axis += 1) {
      if (fitted[axis] > 2 && fitted[axis] > largestAxis) {
        largestAxis = fitted[axis]
        axisToReduce = axis
      }
    }
    if (axisToReduce < 0) {
      break
    }
    fitted[axisToReduce] -= 1
  }

  return fitted
}

function calculateAdaptiveResolution(
  bounds: IrradianceVolumeGrid['bounds'],
  voxelsPerUnit: number,
): Vec3Tuple {
  const size = boundsSize(bounds)

  return [
    clampInteger(Math.round(size.x * voxelsPerUnit), 2, 96),
    clampInteger(Math.round(size.y * voxelsPerUnit), 2, 48),
    clampInteger(Math.round(size.z * voxelsPerUnit), 2, 96),
  ]
}

function createDetailVolumePlan(
  bounds: IrradianceVolumeGrid['bounds'],
  meshes: AbstractMesh[],
  baseResolution: Vec3Tuple,
  lights: BakeLightConfig[],
): DetailVolumePlan {
  const localLightPlan = createLocalLightDetailVolumePlan(bounds, baseResolution, lights)
  if (localLightPlan) {
    return localLightPlan
  }

  const min = new Vector3(bounds.min[0], bounds.min[1], bounds.min[2])
  const max = new Vector3(bounds.max[0], bounds.max[1], bounds.max[2])
  const size = max.subtract(min)
  const geometryBounds = createGeometryDensityBounds(bounds, meshes)

  if (geometryBounds) {
    return {
      bounds: geometryBounds,
      source: 'geometry',
      localLightCount: 0,
      totalLocalLightCount: 0,
      localLightTypes: [],
    }
  }

  const horizontalInset = Math.min(size.x, size.z) * 0.08
  const detailMin = new Vector3(min.x + horizontalInset, min.y, min.z + horizontalInset)
  const detailMax = new Vector3(max.x - horizontalInset, min.y + Math.max(size.y * 0.58, 2.5), max.z - horizontalInset)

  return {
    bounds: {
      min: vector3ToTuple(detailMin),
      max: vector3ToTuple(detailMax),
    },
    source: 'geometry',
    localLightCount: 0,
    totalLocalLightCount: 0,
    localLightTypes: [],
  }
}

type LocalLightDetailCandidate = {
  bounds: IrradianceVolumeGrid['bounds']
  volume: number
  score: number
  lightType: 'spot' | 'rectArea'
}

function createLocalLightDetailVolumePlan(
  sceneBounds: IrradianceVolumeGrid['bounds'],
  baseResolution: Vec3Tuple,
  lights: BakeLightConfig[],
): DetailVolumePlan | null {
  // Directional light has no bounded high-gradient near field, so allocating a
  // light-specific detail AABB would only duplicate most of the base volume.
  // Point lights continue to rely on the base grid (and the geometry-detail
  // fallback when no bounded candidate is active); Spot and RectArea are the
  // newly added types that benefit from bounded local regions.
  const localLights = lights.filter(
    (light): light is BakeLightConfig & { type: 'spot' | 'rectArea' } =>
      light.enabled && (light.type === 'spot' || light.type === 'rectArea') && light.intensity > 0,
  )
  if (localLights.length === 0) {
    return null
  }

  const sceneSize = boundsSize(sceneBounds)
  const largestBaseCell = Math.max(
    sceneSize.x / baseResolution[0],
    sceneSize.y / baseResolution[1],
    sceneSize.z / baseResolution[2],
  )
  const candidates = localLights
    .map((light) => light.type === 'spot'
      ? createSpotlightDetailCandidate(sceneBounds, light, largestBaseCell)
      : createRectAreaDetailCandidate(sceneBounds, light, largestBaseCell))
    .filter((candidate): candidate is LocalLightDetailCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score)

  if (candidates.length === 0) {
    return null
  }

  let selectedBounds = candidates[0].bounds
  let selectedVolumeSum = candidates[0].volume
  let selectedCount = 1
  const selectedTypes = new Set<'spot' | 'rectArea'>([candidates[0].lightType])

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const mergedBounds = unionVolumeBounds(selectedBounds, candidate.bounds)
    const mergedVolume = volumeBoundsVolume(mergedBounds)
    if (mergedVolume > (selectedVolumeSum + candidate.volume) * LOCAL_LIGHT_DETAIL_MERGE_WASTE_RATIO) {
      continue
    }
    selectedBounds = mergedBounds
    selectedVolumeSum += candidate.volume
    selectedCount += 1
    selectedTypes.add(candidate.lightType)
  }

  return {
    bounds: selectedBounds,
    source: 'localLight',
    localLightCount: selectedCount,
    totalLocalLightCount: candidates.length,
    localLightTypes: [...selectedTypes],
  }
}

function createSpotlightDetailCandidate(
  sceneBounds: IrradianceVolumeGrid['bounds'],
  light: BakeLightConfig,
  largestBaseCell: number,
): LocalLightDetailCandidate | null {
  const sceneMin = new Vector3(sceneBounds.min[0], sceneBounds.min[1], sceneBounds.min[2])
  const sceneMax = new Vector3(sceneBounds.max[0], sceneBounds.max[1], sceneBounds.max[2])
  const position = new Vector3(light.x, light.y, light.z)
  const direction = getLightDirection(light)
  const range = Math.max(0.5, light.range)
  const padding = Math.max(light.sourceRadius, largestBaseCell * 1.5, 0.25)
  const maximumSceneProjection = maximumBoundsProjection(sceneMin, sceneMax, position, direction)
  if (maximumSceneProjection <= 0) {
    return null
  }
  // Stop the detail cone shortly after the last scene point along the light
  // axis. Using the authored range here would create a needlessly wide AABB
  // when a Spotlight continues beyond the volume (for example through a floor).
  const effectiveRange = Math.min(range, maximumSceneProjection + padding)
  const coneRadius = Math.tan(degreesToRadians(Math.min(light.outerConeAngle, 178) * 0.5)) * effectiveRange
  const coneEnd = position.add(direction.scale(effectiveRange))
  const radialExtent = new Vector3(
    coneRadius * Math.sqrt(Math.max(0, 1 - direction.x * direction.x)),
    coneRadius * Math.sqrt(Math.max(0, 1 - direction.y * direction.y)),
    coneRadius * Math.sqrt(Math.max(0, 1 - direction.z * direction.z)),
  )
  const candidateMin = new Vector3(
    Math.min(position.x, coneEnd.x - radialExtent.x) - padding,
    Math.min(position.y, coneEnd.y - radialExtent.y) - padding,
    Math.min(position.z, coneEnd.z - radialExtent.z) - padding,
  )
  const candidateMax = new Vector3(
    Math.max(position.x, coneEnd.x + radialExtent.x) + padding,
    Math.max(position.y, coneEnd.y + radialExtent.y) + padding,
    Math.max(position.z, coneEnd.z + radialExtent.z) + padding,
  )

  candidateMin.maximizeInPlace(sceneMin)
  candidateMax.minimizeInPlace(sceneMax)
  if (
    candidateMax.x - candidateMin.x <= 0.001 ||
    candidateMax.y - candidateMin.y <= 0.001 ||
    candidateMax.z - candidateMin.z <= 0.001
  ) {
    return null
  }

  const candidateBounds = {
    min: vector3ToTuple(candidateMin),
    max: vector3ToTuple(candidateMax),
  }
  const volume = volumeBoundsVolume(candidateBounds)
  const score = light.intensity * effectiveRange / Math.max(coneRadius, largestBaseCell)

  return { bounds: candidateBounds, volume, score, lightType: 'spot' }
}

function createRectAreaDetailCandidate(
  sceneBounds: IrradianceVolumeGrid['bounds'],
  light: BakeLightConfig,
  largestBaseCell: number,
): LocalLightDetailCandidate | null {
  const sceneMin = new Vector3(sceneBounds.min[0], sceneBounds.min[1], sceneBounds.min[2])
  const sceneMax = new Vector3(sceneBounds.max[0], sceneBounds.max[1], sceneBounds.max[2])
  const sceneDiagonal = sceneMax.subtract(sceneMin).length()
  const position = new Vector3(light.x, light.y, light.z)
  const rotation = getLightRotation(light)
  const direction = getLightDirection(light)
  const right = Vector3.Right().applyRotationQuaternion(rotation).normalize()
  const up = Vector3.Up().applyRotationQuaternion(rotation).normalize()
  const padding = Math.max(largestBaseCell * 1.5, 0.25)
  const maximumSceneProjection = maximumBoundsProjection(sceneMin, sceneMax, position, direction)
  if (maximumSceneProjection <= 0) {
    return null
  }

  // Rect-area illumination is hemispherical, but its highest spatial
  // frequencies are near the emitter. Refine that near field instead of
  // duplicating the full scene volume for a theoretically infinite light.
  const emitterExtent = Math.max(light.width, light.height)
  const nearFieldDistance = Math.max(largestBaseCell * 6, emitterExtent * 3)
  const effectiveDistance = Math.min(
    maximumSceneProjection + padding,
    nearFieldDistance,
    sceneDiagonal * 0.4,
  )
  if (effectiveDistance <= 0.001) {
    return null
  }

  const endCenter = position.add(direction.scale(effectiveDistance))
  const lateralSpread = Math.max(largestBaseCell * 1.5, effectiveDistance * 0.35)
  const sourceHalfWidth = light.width * 0.5
  const sourceHalfHeight = light.height * 0.5
  const sourceExtent = orientedRectangleAabbExtent(right, up, sourceHalfWidth, sourceHalfHeight)
  const endExtent = orientedRectangleAabbExtent(
    right,
    up,
    sourceHalfWidth + lateralSpread,
    sourceHalfHeight + lateralSpread,
  )
  const candidateMin = new Vector3(
    Math.min(position.x - sourceExtent.x, endCenter.x - endExtent.x) - padding,
    Math.min(position.y - sourceExtent.y, endCenter.y - endExtent.y) - padding,
    Math.min(position.z - sourceExtent.z, endCenter.z - endExtent.z) - padding,
  )
  const candidateMax = new Vector3(
    Math.max(position.x + sourceExtent.x, endCenter.x + endExtent.x) + padding,
    Math.max(position.y + sourceExtent.y, endCenter.y + endExtent.y) + padding,
    Math.max(position.z + sourceExtent.z, endCenter.z + endExtent.z) + padding,
  )

  candidateMin.maximizeInPlace(sceneMin)
  candidateMax.minimizeInPlace(sceneMax)
  if (
    candidateMax.x - candidateMin.x <= 0.001 ||
    candidateMax.y - candidateMin.y <= 0.001 ||
    candidateMax.z - candidateMin.z <= 0.001
  ) {
    return null
  }

  const candidateBounds = {
    min: vector3ToTuple(candidateMin),
    max: vector3ToTuple(candidateMax),
  }
  const volume = volumeBoundsVolume(candidateBounds)
  const emitterArea = Math.max(light.width * light.height, 0.0025)
  const score = light.intensity * Math.sqrt(emitterArea) / Math.max(effectiveDistance, largestBaseCell)

  return { bounds: candidateBounds, volume, score, lightType: 'rectArea' }
}

function orientedRectangleAabbExtent(
  right: Vector3,
  up: Vector3,
  halfWidth: number,
  halfHeight: number,
): Vector3 {
  return new Vector3(
    Math.abs(right.x) * halfWidth + Math.abs(up.x) * halfHeight,
    Math.abs(right.y) * halfWidth + Math.abs(up.y) * halfHeight,
    Math.abs(right.z) * halfWidth + Math.abs(up.z) * halfHeight,
  )
}

function formatDetailLightTypes(types: Array<'spot' | 'rectArea'>): string {
  return types.map((type) => type === 'spot' ? 'Spot' : 'Rect Area').join('/')
}

function maximumBoundsProjection(
  boundsMin: Vector3,
  boundsMax: Vector3,
  origin: Vector3,
  direction: Vector3,
): number {
  const supportPoint = new Vector3(
    direction.x >= 0 ? boundsMax.x : boundsMin.x,
    direction.y >= 0 ? boundsMax.y : boundsMin.y,
    direction.z >= 0 ? boundsMax.z : boundsMin.z,
  )

  return Vector3.Dot(supportPoint.subtract(origin), direction)
}

function unionVolumeBounds(
  first: IrradianceVolumeGrid['bounds'],
  second: IrradianceVolumeGrid['bounds'],
): IrradianceVolumeGrid['bounds'] {
  return {
    min: [
      Math.min(first.min[0], second.min[0]),
      Math.min(first.min[1], second.min[1]),
      Math.min(first.min[2], second.min[2]),
    ],
    max: [
      Math.max(first.max[0], second.max[0]),
      Math.max(first.max[1], second.max[1]),
      Math.max(first.max[2], second.max[2]),
    ],
  }
}

function volumeBoundsVolume(bounds: IrradianceVolumeGrid['bounds']): number {
  const size = boundsSize(bounds)

  return size.x * size.y * size.z
}

function createGeometryDensityBounds(
  bounds: IrradianceVolumeGrid['bounds'],
  meshes: AbstractMesh[],
): IrradianceVolumeGrid['bounds'] | null {
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

function boundsSize(bounds: IrradianceVolumeGrid['bounds']): Vector3 {
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

function sanitizeLightConfig(config: BakeLightConfig): void {
  if (!['point', 'spot', 'directional', 'rectArea'].includes(config.type)) {
    config.type = 'point'
  }
  config.name = config.name.trim() || `${getLightTypeLabel(config.type)} ${config.id}`
  config.x = clampNumber(config.x, -20, 20)
  config.y = clampNumber(config.y, -2, 20)
  config.z = clampNumber(config.z, -20, 20)
  config.rotationX = clampNumber(config.rotationX, -180, 180)
  config.rotationY = clampNumber(config.rotationY, -180, 180)
  config.rotationZ = clampNumber(config.rotationZ, -180, 180)
  config.sourceRadius = clampNumber(config.sourceRadius, 0, 6)
  config.angularRadius = clampNumber(config.angularRadius, 0, 10)
  config.range = clampNumber(config.range, 0.5, 80)
  config.intensity = clampNumber(
    config.intensity,
    0,
    config.type === 'directional' ? 200000 : config.type === 'rectArea' ? 100000 : 10000,
  )
  config.outerConeAngle = clampNumber(config.outerConeAngle, 1, 179)
  config.innerConeAngle = clampNumber(config.innerConeAngle, 0, config.outerConeAngle - 0.1)
  config.width = clampNumber(config.width, 0.05, 20)
  config.height = clampNumber(config.height, 0.05, 20)
  config.color = normalizeHexColor(config.color)
}

function getLightTypeLabel(type: BakeLightType): string {
  switch (type) {
    case 'spot':
      return 'Spot'
    case 'directional':
      return 'Directional'
    case 'rectArea':
      return 'Rect Area'
    default:
      return 'Point'
  }
}

function getRuntimeLightType(light: Light): BakeLightType {
  if (light instanceof SpotLight) {
    return 'spot'
  }
  if (light instanceof DirectionalLight) {
    return 'directional'
  }
  if (light instanceof RectAreaLight) {
    return 'rectArea'
  }

  return 'point'
}

function getLightIntensityUnit(type: BakeLightType): 'cd' | 'lux' | 'cd/m2' {
  if (type === 'directional') {
    return 'lux'
  }
  if (type === 'rectArea') {
    return 'cd/m2'
  }

  return 'cd'
}

function rememberLightIntensity(id: number, type: BakeLightType, intensity: number): void {
  const history = lightIntensityHistory.get(id) ?? {}
  history[type] = intensity
  lightIntensityHistory.set(id, history)
}

function getLightRotation(config: BakeLightConfig): Quaternion {
  return Quaternion.FromEulerAngles(
    degreesToRadians(config.rotationX),
    degreesToRadians(config.rotationY),
    degreesToRadians(config.rotationZ),
  )
}

function getLightDirection(config: BakeLightConfig): Vector3 {
  return Vector3.Backward().applyRotationQuaternion(getLightRotation(config)).normalize()
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI
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
