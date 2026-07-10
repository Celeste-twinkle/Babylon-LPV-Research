import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines'
import type { Scene } from '@babylonjs/core/scene'
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Constants } from '@babylonjs/core/Engines/constants'
import { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { RawTexture3D } from '@babylonjs/core/Materials/Textures/rawTexture3D'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { ToHalfFloat } from '@babylonjs/core/Misc/halfFloat'

import type { BinaryIrradianceVolume } from './irradianceVolume'
import {
  probeIndex,
} from './irradianceVolume'

const IVOL_RUNTIME_ATLAS_TILE_COUNT = 3
const IVOL_ATLAS_COMPONENT_OFFSETS = [
  [0, 1, 2, 9],
  [3, 4, 5, 10],
  [6, 7, 8, 11],
] as const

export type IrradianceVolumeTexture = {
  texture: RawTexture3D
  atlasResolution: Vector3
  base: IrradianceVolumeAtlasRegion
  detail: IrradianceVolumeAtlasRegion | null
  manualFiltering: number
}

export type IrradianceVolumeAtlasRegion = {
  boundsMin: Vector3
  boundsMax: Vector3
  resolution: Vector3
  islandOffsets: [Vector3, Vector3, Vector3]
}

export type IrradianceVolumePbrSettings = {
  intensity: number
  specularEnabled: boolean
  dominantSpecular: boolean
  normalBias: number
}

export class IrradianceVolumePbrPlugin extends MaterialPluginBase {
  private _resource: IrradianceVolumeTexture | null = null
  private _intensity = 1
  private _specularEnabled = true
  private _dominantSpecular = false
  private _normalBias = 0

  constructor(material: Material) {
    super(material, 'IrradianceVolumePbr', 210, {
      IVOL_PBR: false,
      IVOL_DETAIL_PBR: false,
      IVOL_SPECULAR: false,
      IVOL_DOMINANT_SPECULAR: false,
    })
  }

  get intensity(): number {
    return this._intensity
  }

  set intensity(value: number) {
    this._intensity = Math.max(0, value)
  }

  get specularEnabled(): boolean {
    return this._specularEnabled
  }

  set specularEnabled(value: boolean) {
    if (this._specularEnabled === value) {
      return
    }

    this._specularEnabled = value
    this.markAllDefinesAsDirty()
  }

  get dominantSpecular(): boolean {
    return this._dominantSpecular
  }

  set dominantSpecular(value: boolean) {
    if (this._dominantSpecular === value) {
      return
    }

    this._dominantSpecular = value
    this.markAllDefinesAsDirty()
  }

  get normalBias(): number {
    return this._normalBias
  }

  set normalBias(value: number) {
    this._normalBias = Number.isFinite(value) ? value : 0
  }

  setVolume(resource: IrradianceVolumeTexture | null): void {
    this._resource = resource
    this._enable(resource !== null)
    this.markAllDefinesAsDirty()
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL
  }

  override isReadyForSubMesh(): boolean {
    return this._resource?.texture.isReady() ?? true
  }

  override prepareDefines(defines: MaterialDefines): void {
    const typedDefines = defines as MaterialDefines & {
      IVOL_PBR: boolean
      IVOL_DETAIL_PBR: boolean
      IVOL_SPECULAR: boolean
      IVOL_DOMINANT_SPECULAR: boolean
    }
    typedDefines.IVOL_PBR = this._resource !== null
    typedDefines.IVOL_DETAIL_PBR = this._resource?.detail !== null
    typedDefines.IVOL_SPECULAR = this._resource !== null && this._specularEnabled
    typedDefines.IVOL_DOMINANT_SPECULAR = typedDefines.IVOL_SPECULAR && this._dominantSpecular
  }

  override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh,
  ): void {
    if (!this._resource) {
      return
    }

    const resource = this._resource
    const base = resource.base
    uniformBuffer.updateVector3('ivolMin', base.boundsMin)
    uniformBuffer.updateVector3('ivolMax', base.boundsMax)
    uniformBuffer.updateVector3('ivolResolution', base.resolution)
    uniformBuffer.updateVector3('ivolAtlasResolution', resource.atlasResolution)
    uniformBuffer.updateVector3('ivolIsland0', base.islandOffsets[0])
    uniformBuffer.updateVector3('ivolIsland1', base.islandOffsets[1])
    uniformBuffer.updateVector3('ivolIsland2', base.islandOffsets[2])
    uniformBuffer.updateFloat('ivolIntensity', this._intensity)
    uniformBuffer.updateFloat('ivolNormalBias', this._normalBias)
    uniformBuffer.updateFloat('ivolManualFiltering', resource.manualFiltering)
    uniformBuffer.setTexture('ivolShAtlasTexture', resource.texture)

    if (resource.detail) {
      const detail = resource.detail
      uniformBuffer.updateVector3('ivolDetailMin', detail.boundsMin)
      uniformBuffer.updateVector3('ivolDetailMax', detail.boundsMax)
      uniformBuffer.updateVector3('ivolDetailResolution', detail.resolution)
      uniformBuffer.updateVector3('ivolDetailIsland0', detail.islandOffsets[0])
      uniformBuffer.updateVector3('ivolDetailIsland1', detail.islandOffsets[1])
      uniformBuffer.updateVector3('ivolDetailIsland2', detail.islandOffsets[2])
    }
  }

  override hasTexture(texture: BaseTexture): boolean {
    return this._resource?.texture === texture
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    if (this._resource) {
      activeTextures.push(this._resource.texture)
    }
  }

  override getSamplers(samplers: string[]): void {
    if (this._resource) {
      samplers.push('ivolShAtlasTexture')
    }
  }

  override getUniforms(): ReturnType<MaterialPluginBase['getUniforms']> {
    return {
      ubo: [
        { name: 'ivolMin', size: 3, type: 'vec3' },
        { name: 'ivolMax', size: 3, type: 'vec3' },
        { name: 'ivolResolution', size: 3, type: 'vec3' },
        { name: 'ivolAtlasResolution', size: 3, type: 'vec3' },
        { name: 'ivolIsland0', size: 3, type: 'vec3' },
        { name: 'ivolIsland1', size: 3, type: 'vec3' },
        { name: 'ivolIsland2', size: 3, type: 'vec3' },
        { name: 'ivolIntensity', size: 1, type: 'float' },
        { name: 'ivolNormalBias', size: 1, type: 'float' },
        { name: 'ivolManualFiltering', size: 1, type: 'float' },
        { name: 'ivolDetailMin', size: 3, type: 'vec3' },
        { name: 'ivolDetailMax', size: 3, type: 'vec3' },
        { name: 'ivolDetailResolution', size: 3, type: 'vec3' },
        { name: 'ivolDetailIsland0', size: 3, type: 'vec3' },
        { name: 'ivolDetailIsland1', size: 3, type: 'vec3' },
        { name: 'ivolDetailIsland2', size: 3, type: 'vec3' },
      ],
    }
  }

  override getCustomCode(
    shaderType: string,
    shaderLanguage = ShaderLanguage.GLSL,
  ): ReturnType<MaterialPluginBase['getCustomCode']> {
    if (shaderType !== 'fragment' || shaderLanguage !== ShaderLanguage.GLSL) {
      return null
    }

    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
float ivolIntensityResponse(float intensity) {
  return max(intensity, 0.0);
}

#if defined(IVOL_PBR) || defined(IVOL_DETAIL_PBR)
precision highp sampler3D;
#endif

#ifdef IVOL_PBR
uniform sampler3D ivolShAtlasTexture;
#endif

#if defined(IVOL_PBR) || defined(IVOL_DETAIL_PBR)
struct ivolSampleOut {
  vec3 sh0;
  vec3 sh1;
  vec3 sh2;
  vec3 sh3;
};

vec3 ivolEvaluateDirectionalIrradiance(ivolSampleOut sampleValue, vec3 normal) {
  vec3 n = normalize(normal);
  vec3 l1 = sampleValue.sh1 * n.x + sampleValue.sh2 * n.y + sampleValue.sh3 * n.z;
  vec3 rawIrradiance = sampleValue.sh0 + l1;
  return max(rawIrradiance, vec3(0.0));
}

float ivolDistributionGgx(float normalDotHalf, float roughness) {
  float f = (roughness - 1.0) * ((roughness + 1.0) * normalDotHalf * normalDotHalf) + 1.0;
  return (roughness * roughness) / (3.14159265359 * f * f);
}

vec3 ivolSafeNormalize(vec3 value) {
  return value * inversesqrt(max(dot(value, value), 0.00000001));
}

vec3 ivolL1Red(ivolSampleOut sampleValue) {
  return vec3(sampleValue.sh1.r, sampleValue.sh2.r, sampleValue.sh3.r);
}

vec3 ivolL1Green(ivolSampleOut sampleValue) {
  return vec3(sampleValue.sh1.g, sampleValue.sh2.g, sampleValue.sh3.g);
}

vec3 ivolL1Blue(ivolSampleOut sampleValue) {
  return vec3(sampleValue.sh1.b, sampleValue.sh2.b, sampleValue.sh3.b);
}

vec3 ivolEvaluateFullSpecular(
  ivolSampleOut sampleValue,
  vec3 normal,
  vec3 viewDirection,
  float materialRoughness,
  vec3 f0
) {
  vec3 n = ivolSafeNormalize(normal);
  vec3 v = ivolSafeNormalize(viewDirection);
  vec3 l1r = ivolL1Red(sampleValue);
  vec3 l1g = ivolL1Green(sampleValue);
  vec3 l1b = ivolL1Blue(sampleValue);
  vec3 specularColor = max(vec3(
    dot(reflect(-l1r, n), v),
    dot(reflect(-l1g, n), v),
    dot(reflect(-l1b, n), v)
  ), vec3(0.0));
  vec3 rHalf = ivolSafeNormalize(ivolSafeNormalize(l1r) + v);
  vec3 gHalf = ivolSafeNormalize(ivolSafeNormalize(l1g) + v);
  vec3 bHalf = ivolSafeNormalize(ivolSafeNormalize(l1b) + v);
  float smoothness = 1.0 - clamp(materialRoughness, 0.0, 1.0);
  float lightVolumeRoughness = 1.0 - smoothness * 0.9;
  float roughnessExponent = lightVolumeRoughness * lightVolumeRoughness;
  float rSpecular = ivolDistributionGgx(saturate(dot(n, rHalf)), roughnessExponent);
  float gSpecular = ivolDistributionGgx(saturate(dot(n, gHalf)), roughnessExponent);
  float bSpecular = ivolDistributionGgx(saturate(dot(n, bHalf)), roughnessExponent);
  vec3 specular = (rSpecular + gSpecular + bSpecular) * f0;
  vec3 coloredSpecular = specular * specularColor;
  vec3 roughResult = coloredSpecular + specular * sampleValue.sh0;
  vec3 smoothResult = coloredSpecular * 3.0;
  return max(mix(roughResult, smoothResult, smoothness) * 0.5, vec3(0.0));
}

vec3 ivolEvaluateDominantSpecular(
  ivolSampleOut sampleValue,
  vec3 normal,
  vec3 viewDirection,
  float materialRoughness,
  vec3 f0
) {
  vec3 n = ivolSafeNormalize(normal);
  vec3 v = ivolSafeNormalize(viewDirection);
  vec3 dominantDirection = ivolL1Red(sampleValue) + ivolL1Green(sampleValue) + ivolL1Blue(sampleValue);
  vec3 halfDirection = ivolSafeNormalize(ivolSafeNormalize(dominantDirection) + v);
  float smoothness = 1.0 - clamp(materialRoughness, 0.0, 1.0);
  float lightVolumeRoughness = 1.0 - smoothness * 0.9;
  float roughnessExponent = lightVolumeRoughness * lightVolumeRoughness;
  float specular = ivolDistributionGgx(saturate(dot(n, halfDirection)), roughnessExponent);
  return max(specular * sampleValue.sh0 * f0, vec3(0.0)) * 1.5;
}

vec3 ivolPackedAtlasUv(
  vec3 atlasResolution,
  vec3 island0,
  vec3 island1,
  vec3 island2,
  vec3 probe,
  float coefficientIndex
) {
  vec3 islandOffset = coefficientIndex < 0.5
    ? island0
    : (coefficientIndex < 1.5 ? island1 : island2);
  return (islandOffset + probe + vec3(0.5)) / atlasResolution;
}

vec4 ivolReadPackedAtlasProbe(
  vec3 atlasResolution,
  vec3 island0,
  vec3 island1,
  vec3 island2,
  vec3 probe,
  float coefficientIndex
) {
  return texture(ivolShAtlasTexture, ivolPackedAtlasUv(
    atlasResolution,
    island0,
    island1,
    island2,
    probe,
    coefficientIndex
  ));
}

vec4 ivolSamplePackedAtlas(
  vec3 atlasResolution,
  vec3 island0,
  vec3 island1,
  vec3 island2,
  vec3 resolution,
  vec3 local,
  float coefficientIndex,
  float manualFiltering
) {
  // Probe positions are baked at voxel centers: (index + 0.5) / resolution.
  // Map world-space volume coordinates back to that same center convention.
  vec3 probe = clamp(
    clamp(local, vec3(0.0), vec3(1.0)) * resolution - vec3(0.5),
    vec3(0.0),
    max(resolution - vec3(1.0), vec3(0.0))
  );
  vec3 probe0 = floor(probe);
  vec3 probe1 = min(probe0 + vec3(1.0), resolution - vec3(1.0));
  vec3 t = clamp(probe - probe0, vec3(0.0), vec3(1.0));

  if (manualFiltering < 0.5) {
    return ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, probe0 + t, coefficientIndex);
  }

  vec4 p000 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe0.x, probe0.y, probe0.z), coefficientIndex);
  vec4 p100 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe1.x, probe0.y, probe0.z), coefficientIndex);
  vec4 p010 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe0.x, probe1.y, probe0.z), coefficientIndex);
  vec4 p110 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe1.x, probe1.y, probe0.z), coefficientIndex);
  vec4 p001 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe0.x, probe0.y, probe1.z), coefficientIndex);
  vec4 p101 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe1.x, probe0.y, probe1.z), coefficientIndex);
  vec4 p011 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe0.x, probe1.y, probe1.z), coefficientIndex);
  vec4 p111 = ivolReadPackedAtlasProbe(atlasResolution, island0, island1, island2, vec3(probe1.x, probe1.y, probe1.z), coefficientIndex);
  vec4 p00 = mix(p000, p100, t.x);
  vec4 p10 = mix(p010, p110, t.x);
  vec4 p01 = mix(p001, p101, t.x);
  vec4 p11 = mix(p011, p111, t.x);
  return mix(mix(p00, p10, t.y), mix(p01, p11, t.y), t.z);
}

ivolSampleOut ivolDecodePackedSh(vec4 p0, vec4 p1, vec4 p2) {
  ivolSampleOut result;
  result.sh0 = max(p0.rgb, vec3(0.0));
  result.sh1 = p1.rgb;
  result.sh2 = p2.rgb;
  result.sh3 = vec3(p0.a, p1.a, p2.a);
  return result;
}
#endif

#ifdef IVOL_PBR
ivolSampleOut ivolSample(vec3 worldPosition) {
  vec3 volumeSize = max(ivolMax - ivolMin, vec3(0.0001));
  vec3 local = clamp((worldPosition - ivolMin) / volumeSize, vec3(0.0), vec3(1.0));
  return ivolDecodePackedSh(
    ivolSamplePackedAtlas(ivolAtlasResolution, ivolIsland0, ivolIsland1, ivolIsland2, ivolResolution, local, 0.0, ivolManualFiltering),
    ivolSamplePackedAtlas(ivolAtlasResolution, ivolIsland0, ivolIsland1, ivolIsland2, ivolResolution, local, 1.0, ivolManualFiltering),
    ivolSamplePackedAtlas(ivolAtlasResolution, ivolIsland0, ivolIsland1, ivolIsland2, ivolResolution, local, 2.0, ivolManualFiltering)
  );
}
#endif

#ifdef IVOL_DETAIL_PBR
ivolSampleOut ivolDetailSample(vec3 worldPosition) {
  vec3 volumeSize = max(ivolDetailMax - ivolDetailMin, vec3(0.0001));
  vec3 local = clamp((worldPosition - ivolDetailMin) / volumeSize, vec3(0.0), vec3(1.0));
  return ivolDecodePackedSh(
    ivolSamplePackedAtlas(ivolAtlasResolution, ivolDetailIsland0, ivolDetailIsland1, ivolDetailIsland2, ivolDetailResolution, local, 0.0, ivolManualFiltering),
    ivolSamplePackedAtlas(ivolAtlasResolution, ivolDetailIsland0, ivolDetailIsland1, ivolDetailIsland2, ivolDetailResolution, local, 1.0, ivolManualFiltering),
    ivolSamplePackedAtlas(ivolAtlasResolution, ivolDetailIsland0, ivolDetailIsland1, ivolDetailIsland2, ivolDetailResolution, local, 2.0, ivolManualFiltering)
  );
}

float ivolDetailBlend(vec3 worldPosition) {
  vec3 volumeSize = max(ivolDetailMax - ivolDetailMin, vec3(0.0001));
  vec3 local = (worldPosition - ivolDetailMin) / volumeSize;
  vec3 inside = step(vec3(0.0), local) * step(local, vec3(1.0));
  float isInside = inside.x * inside.y * inside.z;
  vec3 edgeDistance = min(local, vec3(1.0) - local);
  float edge = min(min(edgeDistance.x, edgeDistance.y), edgeDistance.z);
  return isInside * smoothstep(0.0, 0.12, edge);
}
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef IVOL_PBR
vec3 ivolSamplePosition = vPositionW + normalW * ivolNormalBias;
ivolSampleOut ivol = ivolSample(ivolSamplePosition);
#ifdef IVOL_DETAIL_PBR
ivolSampleOut ivolDetail = ivolDetailSample(ivolSamplePosition);
float ivolDetailWeight = ivolDetailBlend(ivolSamplePosition);
ivol.sh0 = mix(ivol.sh0, ivolDetail.sh0, ivolDetailWeight);
ivol.sh1 = mix(ivol.sh1, ivolDetail.sh1, ivolDetailWeight);
ivol.sh2 = mix(ivol.sh2, ivolDetail.sh2, ivolDetailWeight);
ivol.sh3 = mix(ivol.sh3, ivolDetail.sh3, ivolDetailWeight);
#endif
vec3 ivolDirectionalRadiance = ivolEvaluateDirectionalIrradiance(ivol, normalW);
float ivolEffectiveIntensity = ivolIntensityResponse(ivolIntensity);
vec3 ivolSurfaceTint = max(surfaceAlbedo, vec3(0.0));
float ivolDiffuseMetallicAttenuation = 1.0;
#if defined(METALLICWORKFLOW) && !defined(LEGACY_SPECULAR_ENERGY_CONSERVATION)
ivolDiffuseMetallicAttenuation = 1.0 - saturate(reflectivityOut.metallic);
#endif
vec3 ivolAmbientOcclusion = clamp(ambientOcclusionForDirectDiffuse, vec3(0.0), vec3(1.0));
vec3 ivolDiffuseRadiance = max(ivolDirectionalRadiance * ivolEffectiveIntensity, vec3(0.0));
finalDiffuse += ivolDiffuseRadiance * ivolSurfaceTint * ivolDiffuseMetallicAttenuation * ivolAmbientOcclusion;
#ifdef IVOL_SPECULAR
vec3 ivolF0 = clamp(reflectivityOut.colorReflectanceF0, vec3(0.0), vec3(1.0));
#ifdef IVOL_DOMINANT_SPECULAR
vec3 ivolSpecularIrradiance = ivolEvaluateDominantSpecular(ivol, normalW, viewDirectionW, roughness, ivolF0);
#else
vec3 ivolSpecularIrradiance = ivolEvaluateFullSpecular(ivol, normalW, viewDirectionW, roughness, ivolF0);
#endif
vec3 ivolSpecularRadiance = max(ivolSpecularIrradiance * ivolEffectiveIntensity, vec3(0.0));
finalEmissive += ivolSpecularRadiance * ivolAmbientOcclusion * ivolAmbientOcclusion;
#endif
#endif
`,
    }
  }
}

export const createIrradianceVolumeTexture = (
  scene: Scene,
  volume: BinaryIrradianceVolume,
  detailVolume: BinaryIrradianceVolume | null = null,
): IrradianceVolumeTexture => {
  const atlasPlan = createAtlasPlan(volume, detailVolume)
  const { width, height, depth } = atlasPlan
  const engine = scene.getEngine()
  const caps = engine.getCaps()
  const useHalfFloat = caps.textureHalfFloat
  const useFloat = caps.textureFloat

  if (!useHalfFloat && !useFloat) {
    throw new Error('Irradiance volumes require half-float or float texture support.')
  }

  assertVolumeTextureDimensions(scene, width, height, depth, 'IVOL SH 3D atlas')
  warnTextureBudget(
    'IVOL SH 3D atlas',
    estimateIrradianceVolumeGpuBytes(volume, detailVolume, useHalfFloat ? 2 : 4),
    96 * 1024 * 1024,
  )

  const canFilter = useHalfFloat
    ? caps.textureHalfFloatLinearFiltering
    : caps.textureFloatLinearFiltering
  const atlasData: Uint16Array | Float32Array = useHalfFloat
    ? new Uint16Array(width * height * depth * 4)
    : new Float32Array(width * height * depth * 4)
  const writeValue = useHalfFloat
    ? (index: number, value: number): void => {
      atlasData[index] = ToHalfFloat(sanitizeHalfFloat(value))
    }
    : (index: number, value: number): void => {
      atlasData[index] = Number.isFinite(value) ? value : 0
    }

  for (const plannedRegion of atlasPlan.regions) {
    writeAtlasRegion(atlasData, width, height, plannedRegion, writeValue)
  }

  const texture = new RawTexture3D(
    atlasData,
    width,
    height,
    depth,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    canFilter ? Texture.TRILINEAR_SAMPLINGMODE : Texture.NEAREST_SAMPLINGMODE,
    useHalfFloat ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_FLOAT,
  )
  texture.name = `ivol-sh-atlas-${width}x${height}x${depth}`
  texture.wrapU = Texture.CLAMP_ADDRESSMODE
  texture.wrapV = Texture.CLAMP_ADDRESSMODE
  texture.wrapR = Texture.CLAMP_ADDRESSMODE

  return {
    texture,
    atlasResolution: new Vector3(width, height, depth),
    base: atlasPlan.regions[0].region,
    detail: atlasPlan.regions[1]?.region ?? null,
    manualFiltering: canFilter ? 0 : 1,
  }
}

export const installIrradianceVolumePbrPlugins = (
  meshes: AbstractMesh[],
): IrradianceVolumePbrPlugin[] => {
  const materials = new Set<Material>()

  for (const mesh of meshes) {
    const material = mesh.material
    if (material instanceof Material && isPbrMaterial(material)) {
      materials.add(material)
    }
  }

  return [...materials].map((material) => new IrradianceVolumePbrPlugin(material))
}

export const updateIrradianceVolumePlugins = (
  plugins: IrradianceVolumePbrPlugin[],
  resource: IrradianceVolumeTexture | null,
  intensity: number,
): void => {
  for (const plugin of plugins) {
    plugin.intensity = intensity
    plugin.setVolume(resource)
  }
}

export const setIrradianceVolumePluginIntensity = (
  plugins: IrradianceVolumePbrPlugin[],
  intensity: number,
): void => {
  for (const plugin of plugins) {
    plugin.intensity = intensity
  }
}

export const setIrradianceVolumePluginPbrSettings = (
  plugins: IrradianceVolumePbrPlugin[],
  settings: Omit<IrradianceVolumePbrSettings, 'intensity'>,
): void => {
  for (const plugin of plugins) {
    plugin.specularEnabled = settings.specularEnabled
    plugin.dominantSpecular = settings.dominantSpecular
    plugin.normalBias = settings.normalBias
  }
}

export const estimateIrradianceVolumeGpuBytes = (
  volume: BinaryIrradianceVolume,
  detailVolume: BinaryIrradianceVolume | null = null,
  componentBytes = Uint16Array.BYTES_PER_ELEMENT,
): number => {
  const atlas = createAtlasPlan(volume, detailVolume)

  return atlas.width * atlas.height * atlas.depth * 4 * componentBytes
}

type IrradianceAtlasPlanRegion = {
  volume: BinaryIrradianceVolume
  region: IrradianceVolumeAtlasRegion
}

type IrradianceAtlasPlan = {
  width: number
  height: number
  depth: number
  regions: IrradianceAtlasPlanRegion[]
}

const createAtlasPlan = (
  volume: BinaryIrradianceVolume,
  detailVolume: BinaryIrradianceVolume | null,
): IrradianceAtlasPlan => {
  const sourceVolumes = detailVolume ? [volume, detailVolume] : [volume]
  const islandCount = sourceVolumes.length * IVOL_RUNTIME_ATLAS_TILE_COUNT
  const cellWidth = Math.max(...sourceVolumes.map((source) => source.resolution[0] + 2))
  const cellHeight = Math.max(...sourceVolumes.map((source) => source.resolution[1] + 2))
  const cellDepth = Math.max(...sourceVolumes.map((source) => source.resolution[2] + 2))
  const grid = chooseAtlasGrid(islandCount, cellWidth, cellHeight, cellDepth)
  const regions = sourceVolumes.map((source) => ({
      volume: source,
      region: {
        boundsMin: new Vector3(source.bounds.min[0], source.bounds.min[1], source.bounds.min[2]),
        boundsMax: new Vector3(source.bounds.max[0], source.bounds.max[1], source.bounds.max[2]),
        resolution: new Vector3(source.resolution[0], source.resolution[1], source.resolution[2]),
        islandOffsets: [Vector3.Zero(), Vector3.Zero(), Vector3.Zero()] as [Vector3, Vector3, Vector3],
      },
    }))

  for (let index = 0; index < islandCount; index += 1) {
    const x = index % grid.x
    const y = Math.floor(index / grid.x) % grid.y
    const z = Math.floor(index / (grid.x * grid.y))
    const regionIndex = Math.floor(index / IVOL_RUNTIME_ATLAS_TILE_COUNT)
    const islandIndex = index % IVOL_RUNTIME_ATLAS_TILE_COUNT
    regions[regionIndex].region.islandOffsets[islandIndex] = new Vector3(
      x * cellWidth + 1,
      y * cellHeight + 1,
      z * cellDepth + 1,
    )
  }

  return {
    width: grid.x * cellWidth,
    height: grid.y * cellHeight,
    depth: grid.z * cellDepth,
    regions,
  }
}

const chooseAtlasGrid = (
  islandCount: number,
  cellWidth: number,
  cellHeight: number,
  cellDepth: number,
): { x: number; y: number; z: number } => {
  let best = { x: islandCount, y: 1, z: 1 }
  let bestMaxDimension = Number.POSITIVE_INFINITY
  let bestVoxelCount = Number.POSITIVE_INFINITY

  for (let z = 1; z <= islandCount; z += 1) {
    for (let y = 1; y <= islandCount; y += 1) {
      const x = Math.ceil(islandCount / (y * z))
      const width = x * cellWidth
      const height = y * cellHeight
      const depth = z * cellDepth
      const maxDimension = Math.max(width, height, depth)
      const voxelCount = width * height * depth

      if (
        maxDimension < bestMaxDimension ||
        (maxDimension === bestMaxDimension && voxelCount < bestVoxelCount)
      ) {
        best = { x, y, z }
        bestMaxDimension = maxDimension
        bestVoxelCount = voxelCount
      }
    }
  }

  return best
}

const writeAtlasRegion = (
  atlasData: Uint16Array | Float32Array,
  atlasWidth: number,
  atlasHeight: number,
  planned: IrradianceAtlasPlanRegion,
  writeValue: (index: number, value: number) => void,
): void => {
  const { volume, region } = planned
  const [xCount, yCount, zCount] = volume.resolution

  for (let island = 0; island < IVOL_RUNTIME_ATLAS_TILE_COUNT; island += 1) {
    const offset = region.islandOffsets[island]
    const componentOffsets = IVOL_ATLAS_COMPONENT_OFFSETS[island]

    for (let z = 0; z < zCount; z += 1) {
      for (let y = 0; y < yCount; y += 1) {
        for (let x = 0; x < xCount; x += 1) {
          const sourceIndex = probeIndex(x, y, z, volume.resolution)
          const sourceBase = sourceIndex * volume.probeStrideFloats
          const targetIndex = atlasVoxelIndex(
            offset.x + x,
            offset.y + y,
            offset.z + z,
            atlasWidth,
            atlasHeight,
          )

          writeValue(targetIndex, volume.payload[sourceBase + componentOffsets[0]])
          writeValue(targetIndex + 1, volume.payload[sourceBase + componentOffsets[1]])
          writeValue(targetIndex + 2, volume.payload[sourceBase + componentOffsets[2]])
          writeValue(targetIndex + 3, volume.payload[sourceBase + componentOffsets[3]])
        }
      }
    }

    for (let z = 0; z < zCount; z += 1) {
      for (let y = 0; y < yCount; y += 1) {
        copyAtlasVoxel(atlasData, atlasWidth, atlasHeight, offset.x, offset.y + y, offset.z + z, offset.x - 1, offset.y + y, offset.z + z)
        copyAtlasVoxel(atlasData, atlasWidth, atlasHeight, offset.x + xCount - 1, offset.y + y, offset.z + z, offset.x + xCount, offset.y + y, offset.z + z)
      }
    }

    for (let z = 0; z < zCount; z += 1) {
      for (let x = -1; x <= xCount; x += 1) {
        copyAtlasVoxel(atlasData, atlasWidth, atlasHeight, offset.x + x, offset.y, offset.z + z, offset.x + x, offset.y - 1, offset.z + z)
        copyAtlasVoxel(atlasData, atlasWidth, atlasHeight, offset.x + x, offset.y + yCount - 1, offset.z + z, offset.x + x, offset.y + yCount, offset.z + z)
      }
    }

    for (let y = -1; y <= yCount; y += 1) {
      for (let x = -1; x <= xCount; x += 1) {
        copyAtlasVoxel(atlasData, atlasWidth, atlasHeight, offset.x + x, offset.y + y, offset.z, offset.x + x, offset.y + y, offset.z - 1)
        copyAtlasVoxel(atlasData, atlasWidth, atlasHeight, offset.x + x, offset.y + y, offset.z + zCount - 1, offset.x + x, offset.y + y, offset.z + zCount)
      }
    }
  }
}

const copyAtlasVoxel = (
  atlasData: Uint16Array | Float32Array,
  atlasWidth: number,
  atlasHeight: number,
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
): void => {
  const source = atlasVoxelIndex(sourceX, sourceY, sourceZ, atlasWidth, atlasHeight)
  const target = atlasVoxelIndex(targetX, targetY, targetZ, atlasWidth, atlasHeight)
  atlasData[target] = atlasData[source]
  atlasData[target + 1] = atlasData[source + 1]
  atlasData[target + 2] = atlasData[source + 2]
  atlasData[target + 3] = atlasData[source + 3]
}

const atlasVoxelIndex = (
  x: number,
  y: number,
  z: number,
  atlasWidth: number,
  atlasHeight: number,
): number => (x + (y + z * atlasHeight) * atlasWidth) * 4

const assertVolumeTextureDimensions = (
  scene: Scene,
  width: number,
  height: number,
  depth: number,
  label: string,
): void => {
  const engine = scene.getEngine() as AbstractEngine & {
    _features?: { support3DTextures?: boolean }
  }

  if (engine._features?.support3DTextures === false) {
    throw new Error(`${label} requires WebGL 2 or WebGPU 3D texture support.`)
  }

  const maxTextureSize = engine.getCaps().maxTextureSize ?? 2048
  if (width > maxTextureSize || height > maxTextureSize || depth > maxTextureSize) {
    throw new Error(`${label} ${width}x${height}x${depth} exceeds the device texture limit ${maxTextureSize}. Lower the bake resolution.`)
  }
}

const warnTextureBudget = (label: string, bytes: number, warningBytes: number): void => {
  if (bytes > warningBytes) {
    console.warn(`${label} uses approximately ${(bytes / (1024 * 1024)).toFixed(1)} MiB of float texture memory.`)
  }
}

const sanitizeHalfFloat = (value: number): number =>
  Number.isFinite(value) ? Math.min(65504, Math.max(-65504, value)) : 0

const isPbrMaterial = (material: Material): boolean => {
  const className = material.getClassName()

  return className.includes('PBR')
}
