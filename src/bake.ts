import './style.css'

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Ray } from '@babylonjs/core/Culling/ray'
import { Scene } from '@babylonjs/core/scene'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager'
import { LightConstants } from '@babylonjs/core/Lights/lightConstants'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { Pane } from 'tweakpane'

import type { IrradianceProbe, IrradianceVolumeData, Vec3Tuple } from './irradianceVolume'
import {
  IRRADIANCE_VOLUME_BINARY_KEY,
  binaryVolumeSummary,
  color3ToTuple,
  getProbePosition,
  parseIvolBinary,
  probeIndex,
  vector3ToTuple,
  volumeSummary,
} from './irradianceVolume'
import type { BakeLightConfig } from './defaultBakeLights'
import { createDefaultBakeLightConfigs } from './defaultBakeLights'
import { createSponzaApp, volumeBoundsFromScene } from './sponzaScene'
import {
  bakeIrradianceVolumeWebGPU,
  canUseWebGPUCompute,
} from './webgpuBake'

type BakeSettings = {
  resolutionX: number
  resolutionY: number
  resolutionZ: number
  bounces: number
  bounceRayCount: number
  areaSamples: number
  exposure: number
  batchSize: number
}

const settings: BakeSettings = {
  resolutionX: 48,
  resolutionY: 24,
  resolutionZ: 48,
  bounces: 6,
  bounceRayCount: 5,
  areaSamples: 4,
  exposure: 1.0,
  batchSize: 512,
}

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
        <a href="./direct-preview.html">Direct Preview</a>
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
            a binary .ivol payload; CPU mode remains as a reference fallback.
          </p>
        </section>

        <section class="tweakpane-section" aria-label="Bake settings">
          <div id="tweakpaneHost" class="tweakpane-host"></div>
        </section>

        <div class="button-row">
          <button id="bakeVolume" type="button">Bake WebGPU .ivol</button>
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
            <li>Binary asset name: <code>${IRRADIANCE_VOLUME_BINARY_KEY}</code></li>
            <li>Use the downloaded .ivol file in the validation page.</li>
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

let latestVolume: IrradianceVolumeData | null = null
let latestBinary: ArrayBuffer | null = null
let probeMeshes: Mesh[] = []
let probeMaterials: StandardMaterial[] = []
let boundsMesh: Mesh | null = null
let lightRuntimes: BakeLightRuntime[] = []
let lightGizmo: GizmoManager | null = null
let pane: Pane | null = null
let activeScene: Scene | null = null
let hasGeneratedBake = false

try {
  const app = await createSponzaApp(canvas, setStatus, true)
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
    `Scene volume bounds ready. Renderer: ${app.usingWebGPU ? 'WebGPU' : 'WebGL fallback'}. Model radius: ${app.bounds.radius.toFixed(2)}.`

  bakeButton.addEventListener('click', () => {
    if (canUseWebGPUCompute(app.engine)) {
      void bakeWebGPU(app, volumeBounds)
    } else {
      void bakeCpuReference(app.importedMeshes, volumeBounds)
    }
  })

  downloadButton.addEventListener('click', () => {
    if (latestBinary) {
      downloadBinary(latestBinary)
    } else if (latestVolume) {
      downloadJson(latestVolume)
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
  disposeProbeMeshes()
  const enabledLights = getEnabledLightRuntimes()

  const resolution: Vec3Tuple = [
    settings.resolutionX,
    settings.resolutionY,
    settings.resolutionZ,
  ]

  setStatus('WebGPU baking physical Babylon lights...')
  volumeState.textContent = 'WebGPU baking...'
  probeCount.textContent = `${resolution[0] * resolution[1] * resolution[2]} probes`
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
      batchSize: settings.batchSize,
      onProgress: setBakeProgress,
    })
    setBakeProgress(96, 'Binary probe payload ready.')
    latestBinary = result.binary
    latestVolume = null
    hasGeneratedBake = true

    const parsed = parseIvolBinary(result.binary)
    setBakeProgress(98, 'Building debug probe preview.')
    createBinaryProbeMeshes(parsed)
    setStatus(`WebGPU bake complete: ${binaryVolumeSummary(parsed)}`)
    volumeState.textContent = 'Ready to download .ivol'
    summaryLine.textContent =
      `Generated binary ${binaryVolumeSummary(parsed)} from ${enabledLights.length} light(s) at ${new Date().toLocaleTimeString()}.`
    downloadButton.disabled = false
    autoDownloadLatestBake()
    setBakeProgress(100, 'Bake complete. The .ivol asset was downloaded automatically.')
  } catch (error) {
    setStatus(`WebGPU bake failed, CPU fallback available: ${(error as Error).message}`, true)
    setBakeProgress(0, 'Bake failed.')
  } finally {
    bakeButton.disabled = false
  }
}

async function bakeCpuReference(
  importedMeshes: AbstractMesh[],
  bounds: IrradianceVolumeData['bounds'],
): Promise<void> {
  sanitizeBakeSettings()
  syncAllBakeLights()
  bakeButton.disabled = true
  downloadButton.disabled = true
  disposeProbeMeshes()
  const enabledLights = getEnabledLightConfigs()

  if (enabledLights.length === 0) {
    setStatus('CPU bake failed: enable at least one point light before baking.', true)
    setBakeProgress(0, 'Bake failed.')
    bakeButton.disabled = false

    return
  }

  const resolution: Vec3Tuple = [
    settings.resolutionX,
    settings.resolutionY,
    settings.resolutionZ,
  ]
  const total = resolution[0] * resolution[1] * resolution[2]
  const probes = new Array<IrradianceProbe>(total)
  const geometry = new Set(importedMeshes)
  const volumeBase = { bounds, resolution }

  volumeState.textContent = 'Baking...'
  probeCount.textContent = `${total} probes`
  setBakeProgress(0, 'CPU reference bake started.')

  let completed = 0
  for (let z = 0; z < resolution[2]; z += 1) {
    for (let y = 0; y < resolution[1]; y += 1) {
      for (let x = 0; x < resolution[0]; x += 1) {
        const position = getProbePosition(volumeBase, x, y, z)
        probes[probeIndex(x, y, z, resolution)] = estimateProbe(position, geometry, bounds, enabledLights)
        completed += 1

        if (completed % 25 === 0) {
          setStatus(`Baking probes: ${completed} / ${total}`)
          setBakeProgress((completed / total) * 90, `CPU baking probes: ${completed} / ${total}.`)
          await nextFrame()
        }
      }
    }
  }

  latestVolume = {
    version: 1,
    name: 'Sponza CPU IrradianceVolume',
    sourceModel: 'Khronos glTF Sample Assets / Sponza',
    createdAt: new Date().toISOString(),
    bounds,
    resolution,
    colorSpace: 'linear',
    probeLayout: 'x-fastest',
    probes,
  }
  latestBinary = null
  hasGeneratedBake = true

  createProbeMeshes(latestVolume)
  setStatus(`Bake complete: ${volumeSummary(latestVolume)}`)
  volumeState.textContent = 'Ready to download JSON'
  summaryLine.textContent =
    `Generated ${volumeSummary(latestVolume)} from ${enabledLights.length} light(s) at ${new Date().toLocaleTimeString()}.`
  bakeButton.disabled = false
  downloadButton.disabled = false
  autoDownloadLatestBake()
  setBakeProgress(100, 'CPU reference bake complete. The JSON asset was downloaded automatically.')
}

function estimateProbe(
  position: Vector3,
  geometry: Set<AbstractMesh>,
  _bounds: IrradianceVolumeData['bounds'],
  enabledLights: BakeLightConfig[],
): IrradianceProbe {
  let directIrradiance = new Color3(0, 0, 0)
  let dominantDirection = Vector3.Up()
  let dominantIntensity = 0

  for (const light of enabledLights) {
    const lightPosition = new Vector3(light.x, light.y, light.z)
    const toLight = lightPosition.subtract(position)
    const directionToLight = toLight.normalize()
    const sourceRadius = Math.max(0, light.sourceRadius)
    const sampleCount = sourceRadius > 0.001 ? settings.areaSamples : 1
    let energy = 0
    let weightedDirection = Vector3.Zero()

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const samplePosition = sampleAreaLightPosition(lightPosition, sourceRadius, sample, sampleCount)
      const sampleToLight = samplePosition.subtract(position)
      const sampleDistanceSquared = Math.max(0.08, sampleToLight.lengthSquared())
      const sampleDistance = Math.sqrt(sampleDistanceSquared)
      const sampleDirectionToLight = sampleToLight.normalize()
      const normalizedDistance = sampleDistance / Math.max(0.001, light.range)
      const rangeAttenuation = clamp01(1 - normalizedDistance * normalizedDistance)
      const visible = visibility(position, sampleDirectionToLight, geometry, sampleDistance)
      const sampleEnergy =
        (light.intensity / (4 * Math.PI * sampleDistanceSquared)) *
        rangeAttenuation *
        rangeAttenuation *
        visible *
        2.4

      energy += sampleEnergy
      weightedDirection = weightedDirection.add(sampleDirectionToLight.scale(sampleEnergy))
    }

    energy /= sampleCount
    const color = hexToColor3(light.color)

    directIrradiance = directIrradiance.add(color.scale(energy))

    if (energy > dominantIntensity) {
      dominantIntensity = energy
      dominantDirection = weightedDirection.lengthSquared() > 0.000001
        ? weightedDirection.normalize()
        : directionToLight
    }
  }

  const ambient = directIrradiance
    .scale(getBounceMultiplier(settings.bounces) * settings.exposure)
    .add(new Color3(0.006, 0.006, 0.007))

  return {
    ambient: color3ToTuple(ambient),
    dominantDirection: vector3ToTuple(dominantDirection),
    dominantIntensity: Number((dominantIntensity * settings.exposure).toFixed(5)),
  }
}

function visibility(
  position: Vector3,
  direction: Vector3,
  geometry: Set<AbstractMesh>,
  length = 120,
): number {
  const origin = position.add(direction.scale(0.08))
  const ray = new Ray(origin, direction, Math.max(0.01, length - 0.12))
  const hit = scenePick(ray, geometry)

  return hit ? 0 : 1
}

function scenePick(ray: Ray, geometry: Set<AbstractMesh>): boolean {
  if (!activeScene) {
    return false
  }

  const scene = activeScene
  const result = scene.pickWithRay(
    ray,
    (mesh) => geometry.has(mesh) && mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0,
    true,
  )

  return result?.hit === true
}

function sampleAreaLightPosition(
  center: Vector3,
  radius: number,
  sampleIndex: number,
  sampleCount: number,
): Vector3 {
  if (radius <= 0.001 || sampleCount <= 1) {
    return center
  }

  const hasCenterSample = sampleCount % 2 === 1

  if (hasCenterSample && sampleIndex === 0) {
    return center
  }

  const pairSampleIndex = hasCenterSample ? sampleIndex - 1 : sampleIndex
  const pairIndex = Math.floor(pairSampleIndex / 2)
  const pairCount = Math.max(1, Math.floor(sampleCount / 2))
  const sample = pairIndex + 0.5
  const z = 1 - (2 * sample) / pairCount
  const radial = Math.sqrt(Math.max(0, 1 - z * z))
  const phi = 2.39996322973 * sample
  const sign = pairSampleIndex % 2 === 0 ? 1 : -1

  const offset = new Vector3(
    Math.cos(phi) * radial * radius,
    z * radius,
    Math.sin(phi) * radial * radius,
  ).scale(sign)

  return center.add(offset)
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
  gridFolder.addBinding(settings, 'exposure', { label: 'Exposure', min: 0.2, max: 3, step: 0.05 })
    .on('change', () => handleBakeSettingsChanged())
  gridFolder.addBinding(settings, 'batchSize', { label: 'Batch probes', min: 64, max: 4096, step: 64 })
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
    setStatus(`Maximum ${MAX_BAKE_LIGHTS} bake lights are supported by the current .ivol baker.`, true)

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

function getEnabledLightConfigs(): BakeLightConfig[] {
  return lightConfigs.filter((config) => config.enabled).slice(0, MAX_BAKE_LIGHTS)
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
  setBakeProgress(0, 'Settings changed. Bake again to update the .ivol asset.')
  downloadButton.disabled = true
}

function createProbeMeshes(volume: IrradianceVolumeData): void {
  if (!activeScene) {
    return
  }

  const marker = MeshBuilder.CreateSphere(
    'probe-marker-template',
    { diameter: 0.16, segments: 8 },
    activeScene,
  )
  marker.isVisible = false

  for (let z = 0; z < volume.resolution[2]; z += 1) {
    for (let y = 0; y < volume.resolution[1]; y += 1) {
      for (let x = 0; x < volume.resolution[0]; x += 1) {
        const index = probeIndex(x, y, z, volume.resolution)
        const probe = volume.probes[index]
        const mesh = marker.clone(`probe-marker-${index}`) as Mesh
        const material = new StandardMaterial(`probe-marker-material-${index}`, activeScene)
        const color = new Color3(probe.ambient[0], probe.ambient[1], probe.ambient[2])

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

function createBinaryProbeMeshes(volume: ReturnType<typeof parseIvolBinary>): void {
  if (!activeScene) {
    return
  }

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
  settings.exposure = clampNumber(settings.exposure, 0.2, 3)
  settings.batchSize = clampInteger(settings.batchSize, 64, 4096)
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

function downloadJson(volume: IrradianceVolumeData): void {
  const blob = new Blob([JSON.stringify(volume, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.href = url
  link.download = 'sponza-irradiance-volume.json'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function downloadBinary(buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.href = url
  link.download = 'sponza-irradiance-volume.ivol'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function autoDownloadLatestBake(): void {
  if (latestBinary) {
    downloadBinary(latestBinary)
  } else if (latestVolume) {
    downloadJson(latestVolume)
  }
}

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing element: ${selector}`)
  }

  return element
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
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

function getBounceMultiplier(bounces: number): number {
  const bounceCount = Math.max(0, Math.floor(bounces))
  let multiplier = 1
  let bounceEnergy = 1

  for (let bounce = 0; bounce < bounceCount; bounce += 1) {
    bounceEnergy *= 0.35
    multiplier += bounceEnergy
  }

  return multiplier
}
