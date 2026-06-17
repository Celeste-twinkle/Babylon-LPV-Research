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
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import type {
  BinaryIrradianceVolume,
  IrradianceVolumeData,
  Vec3Tuple,
} from './irradianceVolume'
import {
  IVOL_PROBE_STRIDE_FLOATS,
  probeIndex,
} from './irradianceVolume'

type LoadedVolume = IrradianceVolumeData | BinaryIrradianceVolume

export type IrradianceVolumeTexture = {
  ambientTexture: RawTexture
  directionTexture: RawTexture
  boundsMin: Vector3
  boundsMax: Vector3
  resolution: Vector3
}

export class IrradianceVolumePbrPlugin extends MaterialPluginBase {
  private _resource: IrradianceVolumeTexture | null = null
  private _intensity = 1

  constructor(material: Material) {
    super(material, 'IrradianceVolumePbr', 210, { IVOL_PBR: false })
  }

  get intensity(): number {
    return this._intensity
  }

  set intensity(value: number) {
    this._intensity = Math.max(0, value)
  }

  setVolume(resource: IrradianceVolumeTexture | null): void {
    const wasEnabled = this._resource !== null
    this._resource = resource
    const isEnabled = resource !== null

    if (wasEnabled !== isEnabled) {
      this._enable(isEnabled)
    }

    this.markAllDefinesAsDirty()
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL
  }

  override isReadyForSubMesh(): boolean {
    return (
      (this._resource?.ambientTexture.isReady() ?? true) &&
      (this._resource?.directionTexture.isReady() ?? true)
    )
  }

  override prepareDefines(defines: MaterialDefines): void {
    ;(defines as MaterialDefines & { IVOL_PBR: boolean }).IVOL_PBR =
      this._resource !== null
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

    uniformBuffer.updateVector3('ivolMin', this._resource.boundsMin)
    uniformBuffer.updateVector3('ivolMax', this._resource.boundsMax)
    uniformBuffer.updateVector3('ivolResolution', this._resource.resolution)
    uniformBuffer.updateFloat('ivolIntensity', this._intensity)
    uniformBuffer.setTexture('ivolAmbientTexture', this._resource.ambientTexture)
    uniformBuffer.setTexture('ivolDirectionTexture', this._resource.directionTexture)
  }

  override hasTexture(texture: BaseTexture): boolean {
    return (
      this._resource?.ambientTexture === texture ||
      this._resource?.directionTexture === texture
    )
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    if (this._resource) {
      activeTextures.push(this._resource.ambientTexture, this._resource.directionTexture)
    }
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('ivolAmbientTexture', 'ivolDirectionTexture')
  }

  override getUniforms(): ReturnType<MaterialPluginBase['getUniforms']> {
    return {
      ubo: [
        { name: 'ivolMin', size: 3, type: 'vec3' },
        { name: 'ivolMax', size: 3, type: 'vec3' },
        { name: 'ivolResolution', size: 3, type: 'vec3' },
        { name: 'ivolIntensity', size: 1, type: 'float' },
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
#ifdef IVOL_PBR
uniform sampler2D ivolAmbientTexture;
uniform sampler2D ivolDirectionTexture;

struct ivolSampleOut {
  vec3 ambient;
  vec3 directionToLight;
  float dominantIntensity;
};

vec4 ivolReadAmbientProbe(float x, float y, float z) {
  float row = y + z * ivolResolution.y;
  vec2 atlasSize = vec2(ivolResolution.x, ivolResolution.y * ivolResolution.z);
  vec2 uv = (vec2(x, row) + vec2(0.5)) / atlasSize;
  return texture2D(ivolAmbientTexture, uv);
}

vec4 ivolReadDirectionProbe(float x, float y, float z) {
  float row = y + z * ivolResolution.y;
  vec2 atlasSize = vec2(ivolResolution.x, ivolResolution.y * ivolResolution.z);
  vec2 uv = (vec2(x, row) + vec2(0.5)) / atlasSize;
  return texture2D(ivolDirectionTexture, uv);
}

ivolSampleOut ivolSample(vec3 worldPosition) {
  vec3 volumeSize = max(ivolMax - ivolMin, vec3(0.0001));
  vec3 local = clamp((worldPosition - ivolMin) / volumeSize, vec3(0.0), vec3(1.0));
  vec3 probe = local * max(ivolResolution - vec3(1.0), vec3(0.0));
  vec3 probe0 = floor(probe);
  vec3 probe1 = min(probe0 + vec3(1.0), ivolResolution - vec3(1.0));
  vec3 t = clamp(probe - probe0, vec3(0.0), vec3(1.0));

  vec4 c000 = ivolReadAmbientProbe(probe0.x, probe0.y, probe0.z);
  vec4 c100 = ivolReadAmbientProbe(probe1.x, probe0.y, probe0.z);
  vec4 c010 = ivolReadAmbientProbe(probe0.x, probe1.y, probe0.z);
  vec4 c110 = ivolReadAmbientProbe(probe1.x, probe1.y, probe0.z);
  vec4 c001 = ivolReadAmbientProbe(probe0.x, probe0.y, probe1.z);
  vec4 c101 = ivolReadAmbientProbe(probe1.x, probe0.y, probe1.z);
  vec4 c011 = ivolReadAmbientProbe(probe0.x, probe1.y, probe1.z);
  vec4 c111 = ivolReadAmbientProbe(probe1.x, probe1.y, probe1.z);

  vec4 d000 = ivolReadDirectionProbe(probe0.x, probe0.y, probe0.z);
  vec4 d100 = ivolReadDirectionProbe(probe1.x, probe0.y, probe0.z);
  vec4 d010 = ivolReadDirectionProbe(probe0.x, probe1.y, probe0.z);
  vec4 d110 = ivolReadDirectionProbe(probe1.x, probe1.y, probe0.z);
  vec4 d001 = ivolReadDirectionProbe(probe0.x, probe0.y, probe1.z);
  vec4 d101 = ivolReadDirectionProbe(probe1.x, probe0.y, probe1.z);
  vec4 d011 = ivolReadDirectionProbe(probe0.x, probe1.y, probe1.z);
  vec4 d111 = ivolReadDirectionProbe(probe1.x, probe1.y, probe1.z);

  vec4 c00 = mix(c000, c100, t.x);
  vec4 c10 = mix(c010, c110, t.x);
  vec4 c01 = mix(c001, c101, t.x);
  vec4 c11 = mix(c011, c111, t.x);
  vec4 c0 = mix(c00, c10, t.y);
  vec4 c1 = mix(c01, c11, t.y);

  vec4 d00 = mix(d000, d100, t.x);
  vec4 d10 = mix(d010, d110, t.x);
  vec4 d01 = mix(d001, d101, t.x);
  vec4 d11 = mix(d011, d111, t.x);
  vec4 d0 = mix(d00, d10, t.y);
  vec4 d1 = mix(d01, d11, t.y);

  vec4 ambientAndRatio = mix(c0, c1, t.z);
  vec4 directionAndIntensity = mix(d0, d1, t.z);

  ivolSampleOut result;
  result.ambient = max(ambientAndRatio.rgb, vec3(0.0));
  result.directionToLight = normalize(directionAndIntensity.xyz);
  result.dominantIntensity = max(directionAndIntensity.w, 0.0);
  return result;
}
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#ifdef IVOL_PBR
ivolSampleOut ivol = ivolSample(vPositionW);
float ivolAmbientEnergy = max(dot(ivol.ambient, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
float ivolDirectRatio = clamp(ivol.dominantIntensity / ivolAmbientEnergy, 0.0, 0.92);
float ivolNdotL = saturate(dot(normalW, ivol.directionToLight));
float ivolDirectional = ivolNdotL * ivolNdotL;
vec3 ivolIndirect = ivol.ambient * (1.0 - ivolDirectRatio) * 0.65;
vec3 ivolDirect = ivol.ambient * ivolDirectRatio * ivolDirectional;
finalDiffuse += (ivolIndirect + ivolDirect) * surfaceAlbedo * ivolIntensity;
#endif
`,
    }
  }
}

export const createIrradianceVolumeTexture = (
  scene: Scene,
  volume: LoadedVolume,
): IrradianceVolumeTexture => {
  const [width, yCount, zCount] = volume.resolution
  const height = yCount * zCount
  const ambientAtlas = new Float32Array(width * height * 4)
  const directionAtlas = new Float32Array(width * height * 4)

  for (let z = 0; z < zCount; z += 1) {
    for (let y = 0; y < yCount; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = probeIndex(x, y, z, volume.resolution)
        const targetIndex = (x + (y + z * yCount) * width) * 4
        const ambient = readAmbient(volume, sourceIndex)
        const directional = readDirectional(volume, sourceIndex)
        const ambientEnergy = luminance(ambient)
        const directRatio = ambientEnergy > 0
          ? Math.min(0.92, Math.max(0, directional.intensity / ambientEnergy))
          : 0

        ambientAtlas[targetIndex] = ambient[0]
        ambientAtlas[targetIndex + 1] = ambient[1]
        ambientAtlas[targetIndex + 2] = ambient[2]
        ambientAtlas[targetIndex + 3] = directRatio
        directionAtlas[targetIndex] = directional.direction[0]
        directionAtlas[targetIndex + 1] = directional.direction[1]
        directionAtlas[targetIndex + 2] = directional.direction[2]
        directionAtlas[targetIndex + 3] = directional.intensity
      }
    }
  }

  const ambientTexture = RawTexture.CreateRGBATexture(
    ambientAtlas,
    width,
    height,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  )
  const directionTexture = RawTexture.CreateRGBATexture(
    directionAtlas,
    width,
    height,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  )

  ambientTexture.name = `ivol-ambient-atlas-${width}x${height}`
  ambientTexture.wrapU = Texture.CLAMP_ADDRESSMODE
  ambientTexture.wrapV = Texture.CLAMP_ADDRESSMODE
  directionTexture.name = `ivol-direction-atlas-${width}x${height}`
  directionTexture.wrapU = Texture.CLAMP_ADDRESSMODE
  directionTexture.wrapV = Texture.CLAMP_ADDRESSMODE

  return {
    ambientTexture,
    directionTexture,
    boundsMin: new Vector3(volume.bounds.min[0], volume.bounds.min[1], volume.bounds.min[2]),
    boundsMax: new Vector3(volume.bounds.max[0], volume.bounds.max[1], volume.bounds.max[2]),
    resolution: new Vector3(volume.resolution[0], volume.resolution[1], volume.resolution[2]),
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

const isPbrMaterial = (material: Material): boolean => {
  const className = material.getClassName()

  return className.includes('PBR')
}

const readAmbient = (volume: LoadedVolume, index: number): Vec3Tuple => {
  if ('kind' in volume) {
    const base = index * IVOL_PROBE_STRIDE_FLOATS

    return [
      volume.payload[base],
      volume.payload[base + 1],
      volume.payload[base + 2],
    ]
  }

  return volume.probes[index].ambient
}

const readDirectional = (
  volume: LoadedVolume,
  index: number,
): { direction: Vec3Tuple; intensity: number } => {
  if ('kind' in volume) {
    const base = index * IVOL_PROBE_STRIDE_FLOATS

    return {
      direction: normalizeTuple([
        volume.payload[base + 12],
        volume.payload[base + 13],
        volume.payload[base + 14],
      ]),
      intensity: Math.max(0, volume.payload[base + 15]),
    }
  }

  const probe = volume.probes[index]

  return {
    direction: normalizeTuple(probe.dominantDirection),
    intensity: Math.max(0, probe.dominantIntensity),
  }
}

const normalizeTuple = (tuple: Vec3Tuple): Vec3Tuple => {
  const length = Math.hypot(tuple[0], tuple[1], tuple[2])

  if (length < 0.00001) {
    return [0, 1, 0]
  }

  return [tuple[0] / length, tuple[1] / length, tuple[2] / length]
}

const luminance = (color: Vec3Tuple): number =>
  Math.max(0, color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722)
