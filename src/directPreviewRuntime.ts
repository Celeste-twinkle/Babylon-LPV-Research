import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Material } from '@babylonjs/core/Materials/material'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import type { BinaryIrradianceVolume } from './irradianceVolume'
import { sampleBinaryIrradianceVolume } from './irradianceVolume'
import type {
  IrradianceVolumePbrPlugin,
  IrradianceVolumeTexture,
  StaticShadowMaskTexture,
} from './irradianceVolumePbrPlugin'
import {
  createIrradianceVolumeTexture,
  createStaticShadowMaskTexture,
  installIrradianceVolumePbrPlugins,
  setIrradianceVolumePluginIntensity,
} from './irradianceVolumePbrPlugin'
import type { BakedDynamicLighting, BakedDynamicObject } from './bakedSponzaRendering'
import {
  animateBakedDynamicObject,
  clampToBinaryVolume,
  configureBakedSponzaStaticMeshes,
  createBakedDynamicDirectLighting,
  createBakedDynamicObjects,
  disableSponzaRuntimeLighting,
  disposeBakedDynamicLighting,
  isInsideBinaryVolume,
  syncBakedSponzaLightingPlugins,
} from './bakedSponzaRendering'
import {
  irradianceBakeBundleQualitySummary,
  irradianceBakeBundleSummary,
  parseIrradianceBakeBundle,
} from './irradianceBakeBundle'
import type { SponzaApp } from './sponzaScene'

export type DirectPreviewBundle = ReturnType<typeof parseIrradianceBakeBundle>

export type DirectPreviewSettings = {
  speed: number
  distance: number
  intensity: number
}

export type DirectPreviewLoadedState = {
  sourceLabel: string
  bundle: DirectPreviewBundle
  volume: BinaryIrradianceVolume
  detailVolume: BinaryIrradianceVolume | null
  dynamicObjects: BakedDynamicObject[]
  staticAudit: StaticSceneAudit
  compileAudit: CompileAudit
  shadowMaskTexture: StaticShadowMaskTexture | null
  dynamicLightCount: number
  dynamicPluginCount: number
  staticPluginCount: number
  cpuPreviewCount: number
}

export type DirectPreviewFrameState = {
  sampleReadout: string
  maxChroma: number
  energyRatio: number
  reasonLine: string
}

export type DirectPreviewRenderer = {
  readonly app: SponzaApp
  readonly shaderErrors: string[]
  readonly loaded: DirectPreviewLoadedState | null
  loadBundle: (bundle: DirectPreviewBundle, sourceLabel: string) => Promise<DirectPreviewLoadedState>
  renderFrame: (settings: DirectPreviewSettings) => DirectPreviewFrameState | null
  disposeLoaded: () => void
}

type DirectPreviewRendererOptions = {
  namePrefix: string
  shaderErrors?: string[]
  frameCameraOnLoad?: boolean
  loadStaticShadowMask?: boolean
  forceStaticCpuPreviewMaterials?: boolean
}

type StaticCpuPreviewMaterial = {
  material: StandardMaterial
  samplePosition: Vector3
}

type CompileAudit = {
  checkedCount: number
  compiledCount: number
  errors: string[]
}

type StaticSceneAudit = {
  meshCount: number
  enabledMeshCount: number
  visibleMeshCount: number
  vertexCount: number
  materialCount: number
  pbrMaterialCount: number
  pluginCount: number
}

type RuntimeBundleResources = {
  volume: BinaryIrradianceVolume
  detailVolume: BinaryIrradianceVolume | null
  volumeTexture: IrradianceVolumeTexture | null
  detailVolumeTexture: IrradianceVolumeTexture | null
  shadowMaskTexture: StaticShadowMaskTexture | null
  dynamicObjects: BakedDynamicObject[]
  dynamicLighting: BakedDynamicLighting | null
  dynamicPlugins: IrradianceVolumePbrPlugin[]
  allPlugins: IrradianceVolumePbrPlugin[]
  staticCpuPreviewMaterials: StaticCpuPreviewMaterial[]
}

const MAX_COMPILE_AUDIT_MATERIALS = 32

export function createDirectPreviewRenderer(
  app: SponzaApp,
  options: DirectPreviewRendererOptions,
): DirectPreviewRenderer {
  const shaderErrors = options.shaderErrors ?? []
  let staticPlugins: IrradianceVolumePbrPlugin[] | null = null
  let resources: RuntimeBundleResources | null = null
  let loadedState: DirectPreviewLoadedState | null = null

  disableSponzaRuntimeLighting(app)
  configureBakedSponzaStaticMeshes(app.importedMeshes)

  const loadBundle = async (
    bundle: DirectPreviewBundle,
    sourceLabel: string,
  ): Promise<DirectPreviewLoadedState> => {
    disposeLoaded()

    const volume = bundle.baseVolume
    const detailVolume = bundle.detailVolume
    const volumeTexture = createIrradianceVolumeTexture(app.scene, volume)
    const detailVolumeTexture = detailVolume
      ? createIrradianceVolumeTexture(app.scene, detailVolume)
      : null
    const shadowMaskTexture = bundle.shadowMask && (options.loadStaticShadowMask ?? true)
      ? createStaticShadowMaskTexture(app.scene, bundle.shadowMask)
      : null
    staticPlugins ??= installIrradianceVolumePbrPlugins(app.importedMeshes)
    const dynamicObjects = createBakedDynamicObjects(app.scene, volume, options.namePrefix)
    const dynamicLighting = createBakedDynamicDirectLighting(
      app.scene,
      dynamicObjects.map((object) => object.mesh),
      app.importedMeshes,
      options.namePrefix,
    )
    const dynamicPlugins = installIrradianceVolumePbrPlugins(dynamicObjects.map((object) => object.mesh))
    const allPlugins = [...staticPlugins, ...dynamicPlugins]

    if (options.frameCameraOnLoad ?? false) {
      frameDiagnosticObjects(app.camera, dynamicObjects, volume)
    }

    syncBakedSponzaLightingPlugins({
      staticPlugins,
      dynamicPlugins,
      volumeTexture,
      detailVolumeTexture,
      shadowMaskTexture,
      intensity: 1,
    })

    const staticAudit = collectStaticSceneAudit(app.importedMeshes, staticPlugins.length)
    const compileAudit = await forceCompileStaticMaterials([
      ...app.importedMeshes,
      ...dynamicObjects.map((object) => object.mesh),
    ])
    const staticCpuPreviewMaterials = options.forceStaticCpuPreviewMaterials
      ? enableStaticCpuPreviewMaterials(app.importedMeshes, volume, detailVolume ?? undefined, 1)
      : []

    resources = {
      volume,
      detailVolume,
      volumeTexture,
      detailVolumeTexture,
      shadowMaskTexture,
      dynamicObjects,
      dynamicLighting,
      dynamicPlugins,
      allPlugins,
      staticCpuPreviewMaterials,
    }
    loadedState = {
      sourceLabel,
      bundle,
      volume,
      detailVolume,
      dynamicObjects,
      staticAudit,
      compileAudit,
      shadowMaskTexture,
      dynamicLightCount: dynamicLighting.lights.length,
      dynamicPluginCount: dynamicPlugins.length,
      staticPluginCount: staticPlugins.length,
      cpuPreviewCount: staticCpuPreviewMaterials.length,
    }

    return loadedState
  }

  const renderFrame = (settings: DirectPreviewSettings): DirectPreviewFrameState | null => {
    if (!resources) {
      return null
    }

    setIrradianceVolumePluginIntensity(resources.allPlugins, settings.intensity)
    updateStaticCpuPreviewMaterials(
      resources.staticCpuPreviewMaterials,
      resources.volume,
      resources.detailVolume ?? undefined,
      settings.intensity,
    )

    const time = performance.now() * 0.001 * settings.speed
    const sampleTexts: string[] = []
    let maxChroma = 0
    let minEnergy = Number.POSITIVE_INFINITY
    let maxEnergy = 0

    for (const object of resources.dynamicObjects) {
      animateBakedDynamicObject(object, time, settings.distance, resources.volume)

      const sample = resources.detailVolume && isInsideBinaryVolume(resources.detailVolume, object.mesh.position)
        ? sampleBinaryIrradianceVolume(resources.detailVolume, object.mesh.position)
        : sampleBinaryIrradianceVolume(resources.volume, object.mesh.position)
      const ambient = sample.ambient.scale(settings.intensity)
      const energy = ambient.r + ambient.g + ambient.b
      const chroma = Math.max(ambient.r, ambient.g, ambient.b) - Math.min(ambient.r, ambient.g, ambient.b)
      const distance = Vector3.Distance(object.mesh.position, object.center)

      minEnergy = Math.min(minEnergy, energy)
      maxEnergy = Math.max(maxEnergy, energy)
      maxChroma = Math.max(maxChroma, chroma)
      sampleTexts.push(`${object.name}/${object.materialLabel}:${ambient.r.toFixed(2)},${ambient.g.toFixed(2)},${ambient.b.toFixed(2)} d=${distance.toFixed(1)}`)
    }

    const energyRatio = maxEnergy / Math.max(0.0001, minEnergy)

    return {
      sampleReadout: `samples: ${sampleTexts.join(' | ')}`,
      maxChroma,
      energyRatio,
      reasonLine: buildDirectPreviewReasonLine(maxChroma, energyRatio),
    }
  }

  const disposeLoaded = (): void => {
    disposeRuntimeResources(resources)
    resources = null
    loadedState = null
  }

  return {
    app,
    shaderErrors,
    get loaded() {
      return loadedState
    },
    loadBundle,
    renderFrame,
    disposeLoaded,
  }
}

export function installDirectPreviewShaderErrorAudit(app: SponzaApp): string[] {
  const errors: string[] = []

  app.engine.onEffectErrorObservable.add(({ errors: effectErrors }) => {
    const message = typeof effectErrors === 'string' ? effectErrors : String(effectErrors)

    errors.push(compactWhitespace(message).slice(0, 220))
  })

  return errors
}

export async function loadDirectPreviewBundle(bundlePath: string): Promise<DirectPreviewBundle> {
  const response = await fetch(assetUrl(bundlePath))

  if (response.ok) {
    return parseIrradianceBakeBundle(await response.arrayBuffer())
  }

  const chunkedBundle = await tryLoadChunkedDirectPreviewBundle(bundlePath)
  if (chunkedBundle) {
    return parseIrradianceBakeBundle(chunkedBundle)
  }

  if (!response.ok) {
    throw new Error(`Could not fetch ${bundlePath}: HTTP ${response.status}.`)
  }

  return parseIrradianceBakeBundle(await response.arrayBuffer())
}

type ChunkedDirectPreviewManifest = {
  chunks: string[]
  size: number
}

async function tryLoadChunkedDirectPreviewBundle(bundlePath: string): Promise<ArrayBuffer | null> {
  const manifestResponse = await fetch(assetUrl(`${bundlePath}.parts.json`))
  if (!manifestResponse.ok) {
    return null
  }

  const manifest = await manifestResponse.json() as ChunkedDirectPreviewManifest
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
    throw new Error(`Invalid chunk manifest for ${bundlePath}.`)
  }

  const basePath = bundlePath.includes('/')
    ? bundlePath.slice(0, bundlePath.lastIndexOf('/') + 1)
    : ''
  const chunks: Uint8Array[] = []
  let totalLength = 0

  for (const chunkName of manifest.chunks) {
    const chunkResponse = await fetch(assetUrl(`${basePath}${chunkName}`))
    if (!chunkResponse.ok) {
      throw new Error(`Could not fetch ${chunkName}: HTTP ${chunkResponse.status}.`)
    }

    const chunk = new Uint8Array(await chunkResponse.arrayBuffer())
    chunks.push(chunk)
    totalLength += chunk.byteLength
  }

  if (Number.isFinite(manifest.size) && manifest.size !== totalLength) {
    throw new Error(`Chunked bundle size mismatch for ${bundlePath}: expected ${manifest.size}, got ${totalLength}.`)
  }

  const bundle = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    bundle.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bundle.buffer
}

export function formatDirectPreviewSummary(state: DirectPreviewLoadedState): string {
  const bundle = state.bundle

  return `${state.sourceLabel}: ${irradianceBakeBundleSummary(bundle)}. ${irradianceBakeBundleQualitySummary(bundle)}. Static surface lightmap ${state.shadowMaskTexture ? 'on' : bundle.shadowMask ? 'off' : 'missing'}. Sponza meshes ${state.staticAudit.visibleMeshCount}/${state.staticAudit.meshCount} visible, vertices ${state.staticAudit.vertexCount}.`
}

export function formatDirectPreviewMaterialLine(
  state: DirectPreviewLoadedState,
  shaderErrorCount: number,
): string {
  return `${state.staticAudit.pbrMaterialCount}/${state.staticAudit.materialCount} static PBR material(s), ${state.staticPluginCount} baked surface plugin(s), ${state.dynamicPluginCount} dynamic VLM plugin(s), ${state.dynamicLightCount} dynamic direct light(s), compiled ${state.compileAudit.compiledCount}/${state.compileAudit.checkedCount}, shader errors ${shaderErrorCount}, static lightmap ${state.shadowMaskTexture ? 'bound' : 'not bound'}, CPU static preview ${state.cpuPreviewCount}.`
}

export function formatDirectPreviewStatus(state: DirectPreviewLoadedState): string {
  return `Loaded direct bundle and compiled ${state.compileAudit.compiledCount} Sponza material(s).`
}

export function formatDirectPreviewErrorLine(
  state: DirectPreviewLoadedState,
  shaderErrors: string[],
): string {
  return [...state.compileAudit.errors, ...shaderErrors].slice(0, 2).join(' | ')
}

export function buildDirectPreviewReasonLine(maxChroma: number, energyRatio: number): string {
  if (maxChroma < 0.08 && energyRatio < 1.35) {
    return 'Weak visible change: the bundle stores smoothed irradiance probes, samples are clamped inside the volume, and the bake includes indirect/bounced energy instead of raw point-light falloff.'
  }

  return `Sample variation is present: max channel spread ${maxChroma.toFixed(2)}, brightness ratio ${energyRatio.toFixed(2)}. Trilinear probe interpolation still smooths local point-light color changes.`
}

function disposeRuntimeResources(resources: RuntimeBundleResources | null): void {
  if (!resources) {
    return
  }

  disposeBakedDynamicLighting(resources.dynamicLighting)
  for (const object of resources.dynamicObjects) {
    object.material.dispose()
    object.mesh.dispose()
  }
  for (const preview of resources.staticCpuPreviewMaterials) {
    preview.material.dispose()
  }
  disposeIrradianceVolumeTexture(resources.volumeTexture)
  disposeIrradianceVolumeTexture(resources.detailVolumeTexture)
  disposeStaticShadowMaskTexture(resources.shadowMaskTexture)
}

function disposeIrradianceVolumeTexture(texture: IrradianceVolumeTexture | null): void {
  for (const shTexture of texture?.shTextures ?? []) {
    shTexture.dispose()
  }
}

function disposeStaticShadowMaskTexture(texture: StaticShadowMaskTexture | null): void {
  texture?.texture.dispose()
  texture?.lightTexture.dispose()
  texture?.depthTexture.dispose()
}

function collectStaticSceneAudit(meshes: AbstractMesh[], pluginCount: number): StaticSceneAudit {
  const materials = new Set<Material>()
  let enabledMeshCount = 0
  let visibleMeshCount = 0
  let vertexCount = 0

  for (const mesh of meshes) {
    if (mesh.isEnabled()) {
      enabledMeshCount += 1
    }
    if (mesh.isVisible && mesh.visibility > 0) {
      visibleMeshCount += 1
    }
    vertexCount += mesh.getTotalVertices()
    if (isMaterial(mesh.material)) {
      materials.add(mesh.material)
    }
  }

  const materialList = [...materials]

  return {
    meshCount: meshes.length,
    enabledMeshCount,
    visibleMeshCount,
    vertexCount,
    materialCount: materialList.length,
    pbrMaterialCount: materialList.filter(isPbrMaterialClass).length,
    pluginCount,
  }
}

async function forceCompileStaticMaterials(meshes: AbstractMesh[]): Promise<CompileAudit> {
  const representatives = new Map<Material, AbstractMesh>()

  for (const mesh of meshes) {
    if (!isMaterial(mesh.material) || !isPbrMaterialClass(mesh.material) || representatives.has(mesh.material)) {
      continue
    }

    representatives.set(mesh.material, mesh)
  }

  const entries = [...representatives.entries()].slice(0, MAX_COMPILE_AUDIT_MATERIALS)
  const errors: string[] = []
  let compiledCount = 0

  for (const [material, mesh] of entries) {
    try {
      await material.forceCompilationAsync(mesh)
      compiledCount += 1
    } catch (error) {
      errors.push(`${material.name || material.getClassName()}: ${compactWhitespace((error as Error).message)}`)
    }
  }

  return {
    checkedCount: entries.length,
    compiledCount,
    errors,
  }
}

function enableStaticCpuPreviewMaterials(
  meshes: AbstractMesh[],
  volume: BinaryIrradianceVolume,
  detailVolume: BinaryIrradianceVolume | undefined,
  intensity: number,
): StaticCpuPreviewMaterial[] {
  const replacements = new Map<Material, StandardMaterial>()
  const previewMaterials: StaticCpuPreviewMaterial[] = []

  for (const mesh of meshes) {
    const sourceMaterial = isMaterial(mesh.material) ? mesh.material : null
    const material = sourceMaterial
      ? getOrCreateStaticPreviewMaterial(mesh, sourceMaterial, replacements)
      : new StandardMaterial(`direct-preview-static-${mesh.name}`, mesh.getScene())
    const samplePosition = meshCenterWorld(mesh)
    const preview: StaticCpuPreviewMaterial = { material, samplePosition }

    material.backFaceCulling = sourceMaterial?.backFaceCulling ?? false
    material.disableLighting = true
    material.specularColor = Color3.Black()
    material.emissiveColor = sampleStaticPreviewColor(samplePosition, volume, detailVolume, intensity)
    mesh.material = material
    previewMaterials.push(preview)
  }

  return previewMaterials
}

function getOrCreateStaticPreviewMaterial(
  mesh: AbstractMesh,
  sourceMaterial: Material,
  replacements: Map<Material, StandardMaterial>,
): StandardMaterial {
  const existing = replacements.get(sourceMaterial)
  if (existing) {
    return existing
  }

  const material = new StandardMaterial(`direct-preview-static-${sourceMaterial.name || mesh.name}`, mesh.getScene())
  const source = sourceMaterial as Material & {
    albedoTexture?: StandardMaterial['diffuseTexture']
    baseColorTexture?: StandardMaterial['diffuseTexture']
    diffuseTexture?: StandardMaterial['diffuseTexture']
    albedoColor?: Color3
    baseColor?: Color3
    diffuseColor?: Color3
  }

  material.diffuseTexture = source.albedoTexture ?? source.baseColorTexture ?? source.diffuseTexture ?? null
  material.diffuseColor = source.albedoColor?.clone() ?? source.baseColor?.clone() ?? source.diffuseColor?.clone() ?? new Color3(0.72, 0.70, 0.66)
  material.alpha = sourceMaterial.alpha
  material.transparencyMode = sourceMaterial.transparencyMode
  material.needDepthPrePass = sourceMaterial.needDepthPrePass
  replacements.set(sourceMaterial, material)

  return material
}

function updateStaticCpuPreviewMaterials(
  previews: StaticCpuPreviewMaterial[],
  volume: BinaryIrradianceVolume,
  detailVolume: BinaryIrradianceVolume | undefined,
  intensity: number,
): void {
  for (const preview of previews) {
    preview.material.emissiveColor = sampleStaticPreviewColor(preview.samplePosition, volume, detailVolume, intensity)
  }
}

function sampleStaticPreviewColor(
  position: Vector3,
  volume: BinaryIrradianceVolume,
  detailVolume: BinaryIrradianceVolume | undefined,
  intensity: number,
): Color3 {
  const sourceVolume = detailVolume && isInsideBinaryVolume(detailVolume, position) ? detailVolume : volume
  const sample = sampleBinaryIrradianceVolume(sourceVolume, position)

  return toneMapPreviewColor(sample.ambient.scale(intensity * 0.85))
}

function meshCenterWorld(mesh: AbstractMesh): Vector3 {
  mesh.computeWorldMatrix(true)
  const box = mesh.getBoundingInfo().boundingBox

  return box.minimumWorld.add(box.maximumWorld).scale(0.5)
}

function frameDiagnosticObjects(
  camera: SponzaApp['camera'],
  objects: BakedDynamicObject[],
  volume: BinaryIrradianceVolume,
): void {
  if (objects.length === 0) {
    return
  }

  const center = objects
    .reduce((sum, object) => sum.add(object.center), Vector3.Zero())
    .scale(1 / objects.length)
  const volumeSize = new Vector3(
    volume.bounds.max[0] - volume.bounds.min[0],
    volume.bounds.max[1] - volume.bounds.min[1],
    volume.bounds.max[2] - volume.bounds.min[2],
  )

  camera.setTarget(clampToBinaryVolume(center, volume))
  camera.alpha = Math.PI * 0.74
  camera.beta = Math.PI * 0.36
  camera.radius = clamp(Math.max(volumeSize.x, volumeSize.z) * 0.46, 10, 24)
}

function toneMapPreviewColor(color: Color3): Color3 {
  const exposure = 0.18
  const mapped = new Color3(
    1 - Math.exp(-Math.max(0, color.r) * exposure),
    1 - Math.exp(-Math.max(0, color.g) * exposure),
    1 - Math.exp(-Math.max(0, color.b) * exposure),
  )
  const floor = 0.08

  return new Color3(
    Math.max(floor, mapped.r),
    Math.max(floor, mapped.g),
    Math.max(floor, mapped.b),
  )
}

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`.replace(/\/{2,}/g, '/')
}

function isMaterial(value: unknown): value is Material {
  return Boolean(value && typeof value === 'object' && 'getClassName' in value)
}

function isPbrMaterialClass(material: Material): boolean {
  return material.getClassName().includes('PBR')
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
