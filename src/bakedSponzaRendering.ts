import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { LightConstants } from '@babylonjs/core/Lights/lightConstants'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import { DEFAULT_BAKE_LIGHT_CONFIGS } from './defaultBakeLights'
import type { BinaryIrradianceVolume } from './irradianceVolume'
import type {
  IrradianceVolumePbrPlugin,
  IrradianceVolumeTexture,
  StaticShadowMaskTexture,
} from './irradianceVolumePbrPlugin'
import {
  updateStaticShadowMaskPlugins,
  updateIrradianceVolumePlugins,
} from './irradianceVolumePbrPlugin'
import type { SponzaApp } from './sponzaScene'

export type BakedDynamicObject = {
  mesh: Mesh
  material: PBRMaterial
  center: Vector3
  name: string
  materialLabel: string
  phase: number
  axisDistance: number
}

export type BakedDynamicLighting = {
  lights: PointLight[]
  shadowGenerators: ShadowGenerator[]
}

type BakedMaterialPreset = {
  label: string
  albedo: Color3
  metallic: number
  roughness: number
}

type SyncBakedSponzaLightingOptions = {
  staticPlugins: IrradianceVolumePbrPlugin[]
  dynamicPlugins: IrradianceVolumePbrPlugin[]
  volumeTexture: IrradianceVolumeTexture | null
  detailVolumeTexture: IrradianceVolumeTexture | null
  shadowMaskTexture: StaticShadowMaskTexture | null
  intensity: number
}

const BAKED_DYNAMIC_MATERIAL_PRESETS: BakedMaterialPreset[] = [
  { label: 'rough stone', albedo: new Color3(0.82, 0.80, 0.74), metallic: 0.0, roughness: 0.86 },
  { label: 'smooth ceramic', albedo: new Color3(0.93, 0.91, 0.86), metallic: 0.0, roughness: 0.28 },
  { label: 'brushed bronze', albedo: new Color3(0.86, 0.57, 0.33), metallic: 0.72, roughness: 0.48 },
  { label: 'polished steel', albedo: new Color3(0.78, 0.80, 0.82), metallic: 1.0, roughness: 0.16 },
]

export function disableSponzaRuntimeLighting(app: SponzaApp): void {
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

export function configureBakedSponzaStaticMeshes(meshes: AbstractMesh[]): void {
  for (const mesh of meshes) {
    mesh.renderingGroupId = 0
    mesh.receiveShadows = true
  }
}

export function syncBakedSponzaLightingPlugins(options: SyncBakedSponzaLightingOptions): void {
  const dynamicDetailTexture = options.shadowMaskTexture ? null : options.detailVolumeTexture

  updateIrradianceVolumePlugins(options.staticPlugins, options.volumeTexture, options.intensity)
  updateStaticShadowMaskPlugins(options.staticPlugins, options.shadowMaskTexture)

  updateIrradianceVolumePlugins(
    options.dynamicPlugins,
    options.volumeTexture,
    options.intensity,
    dynamicDetailTexture,
  )
  updateStaticShadowMaskPlugins(options.dynamicPlugins, null)
}

export function createBakedDynamicObjects(
  scene: Scene,
  volume: BinaryIrradianceVolume,
  namePrefix: string,
): BakedDynamicObject[] {
  const volumeSize = new Vector3(
    volume.bounds.max[0] - volume.bounds.min[0],
    volume.bounds.max[1] - volume.bounds.min[1],
    volume.bounds.max[2] - volume.bounds.min[2],
  )
  const radius = clamp(Math.min(volumeSize.x, volumeSize.z) * 0.014, 0.18, 0.32)

  return DEFAULT_BAKE_LIGHT_CONFIGS.map((light, index) => {
    const center = new Vector3(light.x, light.y, light.z)
    const mesh = index % 2 === 0
      ? MeshBuilder.CreateSphere(`${namePrefix}-pbr-object-${light.id}`, {
        diameter: radius * 2.2,
        segments: 32,
      }, scene)
      : MeshBuilder.CreateBox(`${namePrefix}-pbr-object-${light.id}`, {
        size: radius * 2.0,
      }, scene)
    const material = new PBRMaterial(`${namePrefix}-vlm-pbr-material-${light.id}`, scene)
    const preset = BAKED_DYNAMIC_MATERIAL_PRESETS[index % BAKED_DYNAMIC_MATERIAL_PRESETS.length]

    material.albedoColor = preset.albedo
    material.metallic = preset.metallic
    material.roughness = preset.roughness
    material.environmentIntensity = 0
    material.directIntensity = 1
    material.backFaceCulling = false
    material.forceDepthWrite = true
    mesh.renderingGroupId = 0
    mesh.receiveShadows = true
    mesh.material = material

    return {
      mesh,
      material,
      center,
      name: light.name,
      materialLabel: preset.label,
      phase: index * Math.PI * 0.5,
      axisDistance: Math.max(1.4, light.range * 0.36),
    }
  })
}

export function createBakedDynamicDirectLighting(
  scene: Scene,
  receiverMeshes: AbstractMesh[],
  staticShadowCasters: AbstractMesh[],
  namePrefix: string,
): BakedDynamicLighting {
  const shadowCasters = [...staticShadowCasters, ...receiverMeshes]
  const shadowGenerators: ShadowGenerator[] = []
  const lights = DEFAULT_BAKE_LIGHT_CONFIGS
    .filter((config) => config.enabled && config.intensity > 0 && config.range > 0)
    .map((config) => {
      const light = new PointLight(
        `${namePrefix}-dynamic-direct-${config.id}`,
        new Vector3(config.x, config.y, config.z),
        scene,
      )

      light.intensityMode = LightConstants.INTENSITYMODE_LUMINOUSINTENSITY
      light.falloffType = LightConstants.FALLOFF_PHYSICAL
      light.diffuse = parseColor3(config.color)
      light.specular = light.diffuse.scale(0.55)
      light.intensity = config.intensity
      light.range = config.range
      light.radius = Math.max(0, config.sourceRadius)
      light.includedOnlyMeshes.push(...receiverMeshes)

      const shadowGenerator = new ShadowGenerator(1024, light, true)
      shadowGenerator.usePoissonSampling = true
      shadowGenerator.bias = 0.0008
      shadowGenerator.normalBias = 0.035
      shadowGenerator.setDarkness(0.18)
      for (const caster of shadowCasters) {
        shadowGenerator.addShadowCaster(caster)
      }
      shadowGenerators.push(shadowGenerator)

      return light
    })

  return { lights, shadowGenerators }
}

export function animateBakedDynamicObject(
  object: BakedDynamicObject,
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

  object.mesh.position.copyFrom(clampToBinaryVolume(object.center.add(offset), volume))
  object.mesh.rotation.x = time * 0.75 + object.phase
  object.mesh.rotation.y = time * 1.25
  object.mesh.rotation.z = time * 0.35
}

export function isInsideBinaryVolume(volume: BinaryIrradianceVolume, position: Vector3): boolean {
  return (
    position.x >= volume.bounds.min[0] &&
    position.y >= volume.bounds.min[1] &&
    position.z >= volume.bounds.min[2] &&
    position.x <= volume.bounds.max[0] &&
    position.y <= volume.bounds.max[1] &&
    position.z <= volume.bounds.max[2]
  )
}

export function clampToBinaryVolume(position: Vector3, volume: BinaryIrradianceVolume): Vector3 {
  return new Vector3(
    clamp(position.x, volume.bounds.min[0], volume.bounds.max[0]),
    clamp(position.y, volume.bounds.min[1], volume.bounds.max[1]),
    clamp(position.z, volume.bounds.min[2], volume.bounds.max[2]),
  )
}

export function disposeBakedDynamicLighting(lighting: BakedDynamicLighting | null): void {
  for (const generator of lighting?.shadowGenerators ?? []) {
    generator.dispose()
  }
  for (const light of lighting?.lights ?? []) {
    light.dispose()
  }
}

function parseColor3(value: string): Color3 {
  const normalized = value.trim().replace(/^#/, '')
  const hex = normalized.length === 3
    ? normalized
      .split('')
      .map((char) => `${char}${char}`)
      .join('')
    : normalized.padEnd(6, 'f').slice(0, 6)
  const intValue = Number.parseInt(hex, 16)

  if (!Number.isFinite(intValue)) {
    return Color3.White()
  }

  return new Color3(
    ((intValue >> 16) & 0xff) / 255,
    ((intValue >> 8) & 0xff) / 255,
    (intValue & 0xff) / 255,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
