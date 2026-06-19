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
import type { StaticShadowMask } from './staticShadowMask'

type LoadedVolume = IrradianceVolumeData | BinaryIrradianceVolume

export type IrradianceVolumeTexture = {
  shTextures: RawTexture[]
  boundsMin: Vector3
  boundsMax: Vector3
  resolution: Vector3
}

export type StaticShadowMaskTexture = {
  texture: RawTexture
  lightTexture: RawTexture
  depthTexture: RawTexture
  boundsMin: Vector3
  boundsMax: Vector3
  planeCount: number
}

export class IrradianceVolumePbrPlugin extends MaterialPluginBase {
  private _resource: IrradianceVolumeTexture | null = null
  private _detailResource: IrradianceVolumeTexture | null = null
  private _shadowMask: StaticShadowMaskTexture | null = null
  private _intensity = 1
  private _dynamicReceiverShadow = 1

  constructor(material: Material) {
    super(material, 'IrradianceVolumePbr', 210, {
      IVOL_PBR: false,
      IVOL_DETAIL_PBR: false,
      STATIC_SHADOW_MASK: false,
    })
  }

  get intensity(): number {
    return this._intensity
  }

  set intensity(value: number) {
    this._intensity = Math.max(0, value)
  }

  get dynamicReceiverShadow(): number {
    return this._dynamicReceiverShadow
  }

  set dynamicReceiverShadow(value: number) {
    this._dynamicReceiverShadow = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1))
  }

  setVolume(resource: IrradianceVolumeTexture | null): void {
    const wasEnabled = this._resource !== null || this._detailResource !== null
    this._resource = resource
    const isEnabled = resource !== null || this._detailResource !== null

    if (wasEnabled !== isEnabled || this._shadowMask !== null) {
      this._enable(isEnabled || this._shadowMask !== null)
    }

    this.markAllDefinesAsDirty()
  }

  setDetailVolume(resource: IrradianceVolumeTexture | null): void {
    const wasEnabled = this._resource !== null || this._detailResource !== null
    this._detailResource = resource
    const isEnabled = this._resource !== null || resource !== null

    if (wasEnabled !== isEnabled || this._shadowMask !== null) {
      this._enable(isEnabled || this._shadowMask !== null)
    }

    this.markAllDefinesAsDirty()
  }

  setStaticShadowMask(resource: StaticShadowMaskTexture | null): void {
    const wasEnabled = this._shadowMask !== null
    this._shadowMask = resource
    const isEnabled = resource !== null
    const hasVolume = this._resource !== null || this._detailResource !== null

    if (wasEnabled !== isEnabled || hasVolume) {
      this._enable(isEnabled || hasVolume)
    }

    this.markAllDefinesAsDirty()
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL
  }

  override isReadyForSubMesh(): boolean {
    const detailResource = this.getSequentialDetailResource()

    return (
      (this._resource?.shTextures[0]?.isReady() ?? true) &&
      (detailResource?.shTextures[0]?.isReady() ?? true) &&
      (this._shadowMask?.texture.isReady() ?? true) &&
      (this._shadowMask?.lightTexture.isReady() ?? true) &&
      (this._shadowMask?.depthTexture.isReady() ?? true)
    )
  }

  override prepareDefines(defines: MaterialDefines): void {
    const typedDefines = defines as MaterialDefines & {
      IVOL_PBR: boolean
      IVOL_DETAIL_PBR: boolean
      STATIC_SHADOW_MASK: boolean
    }
    const detailResource = this.getSequentialDetailResource()

    typedDefines.IVOL_PBR = this._resource !== null || detailResource !== null
    typedDefines.IVOL_DETAIL_PBR = this._resource !== null && detailResource !== null
    typedDefines.STATIC_SHADOW_MASK = this._shadowMask !== null
  }

  override bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh,
  ): void {
    if (!this._resource && !this._detailResource) {
      if (!this._shadowMask) {
        return
      }
    }

    const detailResource = this.getSequentialDetailResource()
    const baseResource = this._resource ?? detailResource
    if (baseResource) {
      uniformBuffer.updateVector3('ivolMin', baseResource.boundsMin)
      uniformBuffer.updateVector3('ivolMax', baseResource.boundsMax)
      uniformBuffer.updateVector3('ivolResolution', baseResource.resolution)
      uniformBuffer.updateFloat('ivolIntensity', this._intensity)
      uniformBuffer.updateFloat('ivolDynamicReceiverShadow', this._dynamicReceiverShadow)
      bindFirstShTexture(uniformBuffer, 'ivolSh', baseResource.shTextures)
    }

    if (this._resource && detailResource) {
      uniformBuffer.updateVector3('ivolDetailMin', detailResource.boundsMin)
      uniformBuffer.updateVector3('ivolDetailMax', detailResource.boundsMax)
      uniformBuffer.updateVector3('ivolDetailResolution', detailResource.resolution)
      bindFirstShTexture(uniformBuffer, 'ivolDetailSh', detailResource.shTextures)
    }

    if (this._shadowMask) {
      const shadowMaskSize = this._shadowMask.texture.getSize()

      uniformBuffer.updateVector3('staticShadowMaskMin', this._shadowMask.boundsMin)
      uniformBuffer.updateVector3('staticShadowMaskMax', this._shadowMask.boundsMax)
      uniformBuffer.updateFloat('staticShadowMaskPlaneCount', this._shadowMask.planeCount)
      uniformBuffer.updateFloat2('staticShadowMaskTextureSize', shadowMaskSize.width, shadowMaskSize.height)
      uniformBuffer.setTexture('staticShadowMaskTexture', this._shadowMask.texture)
      uniformBuffer.setTexture('staticSurfaceLightTexture', this._shadowMask.lightTexture)
      uniformBuffer.setTexture('staticSurfaceDepthTexture', this._shadowMask.depthTexture)
    }
  }

  override hasTexture(texture: BaseTexture): boolean {
    const detailResource = this.getSequentialDetailResource()

    return (
      this._resource?.shTextures[0] === texture ||
      detailResource?.shTextures[0] === texture ||
      this._shadowMask?.texture === texture ||
      this._shadowMask?.lightTexture === texture ||
      this._shadowMask?.depthTexture === texture
    )
  }

  override getActiveTextures(activeTextures: BaseTexture[]): void {
    const detailResource = this.getSequentialDetailResource()

    if (this._resource) {
      activeTextures.push(this._resource.shTextures[0])
    }
    if (detailResource) {
      activeTextures.push(detailResource.shTextures[0])
    }
    if (this._shadowMask) {
      activeTextures.push(this._shadowMask.texture)
      activeTextures.push(this._shadowMask.lightTexture)
      activeTextures.push(this._shadowMask.depthTexture)
    }
  }

  override getSamplers(samplers: string[]): void {
    const detailResource = this.getSequentialDetailResource()

    if (this._resource || detailResource) {
      samplers.push('ivolSh0Texture')
    }
    if (this._resource && detailResource) {
      samplers.push('ivolDetailSh0Texture')
    }
    if (this._shadowMask) {
      samplers.push(
        'staticShadowMaskTexture',
        'staticSurfaceLightTexture',
        'staticSurfaceDepthTexture',
      )
    }
  }

  override getUniforms(): ReturnType<MaterialPluginBase['getUniforms']> {
    return {
      ubo: [
        { name: 'ivolMin', size: 3, type: 'vec3' },
        { name: 'ivolMax', size: 3, type: 'vec3' },
        { name: 'ivolResolution', size: 3, type: 'vec3' },
        { name: 'ivolIntensity', size: 1, type: 'float' },
        { name: 'ivolDynamicReceiverShadow', size: 1, type: 'float' },
        { name: 'ivolDetailMin', size: 3, type: 'vec3' },
        { name: 'ivolDetailMax', size: 3, type: 'vec3' },
        { name: 'ivolDetailResolution', size: 3, type: 'vec3' },
        { name: 'staticShadowMaskMin', size: 3, type: 'vec3' },
        { name: 'staticShadowMaskMax', size: 3, type: 'vec3' },
        { name: 'staticShadowMaskPlaneCount', size: 1, type: 'float' },
        { name: 'staticShadowMaskTextureSize', size: 2, type: 'vec2' },
      ],
    }
  }

  private getSequentialDetailResource(): IrradianceVolumeTexture | null {
    return null
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
  return sqrt(max(intensity, 0.0)) * 0.55;
}

vec3 ivolCompressRadiance(vec3 radiance) {
  vec3 safeRadiance = max(radiance, vec3(0.0));
  return safeRadiance / (vec3(1.0) + safeRadiance * 0.75);
}

#ifdef IVOL_PBR
uniform sampler2D ivolSh0Texture;
#endif

#ifdef IVOL_DETAIL_PBR
uniform sampler2D ivolDetailSh0Texture;
#endif

#ifdef STATIC_SHADOW_MASK
uniform sampler2D staticShadowMaskTexture;
uniform sampler2D staticSurfaceLightTexture;
uniform sampler2D staticSurfaceDepthTexture;

vec2 staticShadowMaskAtlasUv(vec2 uv, float planeIndex) {
  float safePlaneCount = max(staticShadowMaskPlaneCount, 1.0);
  return vec2(clamp(uv.x, 0.0, 1.0), (clamp(uv.y, 0.0, 1.0) + planeIndex) / safePlaneCount);
}

float staticShadowMaskSamplePlaneRaw(vec2 uv, float planeIndex) {
  return clamp(texture(staticShadowMaskTexture, staticShadowMaskAtlasUv(uv, planeIndex)).r, 0.0, 1.0);
}

float staticShadowMaskSamplePlane(vec2 uv, float planeIndex) {
  float safePlaneCount = max(staticShadowMaskPlaneCount, 1.0);
  vec2 texel = vec2(
    1.0 / max(staticShadowMaskTextureSize.x, 1.0),
    safePlaneCount / max(staticShadowMaskTextureSize.y, safePlaneCount)
  );
  float center = staticShadowMaskSamplePlaneRaw(uv, planeIndex) * 0.28;
  float axis =
    staticShadowMaskSamplePlaneRaw(uv + vec2(texel.x, 0.0), planeIndex) +
    staticShadowMaskSamplePlaneRaw(uv - vec2(texel.x, 0.0), planeIndex) +
    staticShadowMaskSamplePlaneRaw(uv + vec2(0.0, texel.y), planeIndex) +
    staticShadowMaskSamplePlaneRaw(uv - vec2(0.0, texel.y), planeIndex);
  float diagonal =
    staticShadowMaskSamplePlaneRaw(uv + texel, planeIndex) +
    staticShadowMaskSamplePlaneRaw(uv - texel, planeIndex) +
    staticShadowMaskSamplePlaneRaw(uv + vec2(texel.x, -texel.y), planeIndex) +
    staticShadowMaskSamplePlaneRaw(uv + vec2(-texel.x, texel.y), planeIndex);
  return clamp(center + axis * 0.14 + diagonal * 0.04, 0.0, 1.0);
}

vec3 staticSurfaceLightSamplePlaneRaw(vec2 uv, float planeIndex) {
  return max(texture(staticSurfaceLightTexture, staticShadowMaskAtlasUv(uv, planeIndex)).rgb, vec3(0.0));
}

vec3 staticSurfaceLightSamplePlane(vec2 uv, float planeIndex) {
  float safePlaneCount = max(staticShadowMaskPlaneCount, 1.0);
  vec2 texel = vec2(
    1.0 / max(staticShadowMaskTextureSize.x, 1.0),
    safePlaneCount / max(staticShadowMaskTextureSize.y, safePlaneCount)
  );
  vec3 center = staticSurfaceLightSamplePlaneRaw(uv, planeIndex) * 0.5;
  vec3 axis =
    staticSurfaceLightSamplePlaneRaw(uv + vec2(texel.x, 0.0), planeIndex) +
    staticSurfaceLightSamplePlaneRaw(uv - vec2(texel.x, 0.0), planeIndex) +
    staticSurfaceLightSamplePlaneRaw(uv + vec2(0.0, texel.y), planeIndex) +
    staticSurfaceLightSamplePlaneRaw(uv - vec2(0.0, texel.y), planeIndex);
  return max(center + axis * 0.125, vec3(0.0));
}

float staticSurfaceDepthSamplePlane(vec2 uv, float planeIndex) {
  return texture(staticSurfaceDepthTexture, staticShadowMaskAtlasUv(uv, planeIndex)).r;
}

float staticSurfaceDepthWeight(float localDepth, float storedDepth) {
  float hasStoredDepth = step(0.0, storedDepth);
  float delta = abs(localDepth - storedDepth);
  float depthFootprint = max(fwidth(localDepth) * 2.0, 0.004);
  float depthMatch = 1.0 - smoothstep(depthFootprint, depthFootprint + 0.055, delta);
  return hasStoredDepth * depthMatch;
}

vec3 staticReceiverNormal(vec3 worldPosition, vec3 shadingNormal) {
  vec3 geometricNormal = cross(dFdx(worldPosition), dFdy(worldPosition));
  float lengthSquared = dot(geometricNormal, geometricNormal);
  if (lengthSquared <= 0.000001) {
    return normalize(shadingNormal);
  }

  geometricNormal = normalize(geometricNormal);
  if (dot(geometricNormal, shadingNormal) < 0.0) {
    geometricNormal = -geometricNormal;
  }

  return geometricNormal;
}

vec4 staticShadowAndLightSample(vec3 worldPosition, vec3 normal) {
  vec3 maskSize = max(staticShadowMaskMax - staticShadowMaskMin, vec3(0.0001));
  vec3 local = clamp((worldPosition - staticShadowMaskMin) / maskSize, vec3(0.0), vec3(1.0));
  vec3 receiverNormal = staticReceiverNormal(worldPosition, normal);
  vec3 weight = pow(abs(receiverNormal), vec3(3.0));
  float yPlane = receiverNormal.y >= 0.0 ? 0.0 : 1.0;
  float xPlane = receiverNormal.x >= 0.0 ? 2.0 : 3.0;
  float zPlane = receiverNormal.z >= 0.0 ? 4.0 : 5.0;
  float yMask = staticShadowMaskSamplePlane(local.xz, yPlane);
  float xMask = staticShadowMaskSamplePlane(local.zy, xPlane);
  float zMask = staticShadowMaskSamplePlane(local.xy, zPlane);
  vec3 yLight = staticSurfaceLightSamplePlane(local.xz, yPlane);
  vec3 xLight = staticSurfaceLightSamplePlane(local.zy, xPlane);
  vec3 zLight = staticSurfaceLightSamplePlane(local.xy, zPlane);
  float yDepthWeight = staticSurfaceDepthWeight(local.y, staticSurfaceDepthSamplePlane(local.xz, yPlane));
  float xDepthWeight = staticSurfaceDepthWeight(local.x, staticSurfaceDepthSamplePlane(local.zy, xPlane));
  float zDepthWeight = staticSurfaceDepthWeight(local.z, staticSurfaceDepthSamplePlane(local.xy, zPlane));
  weight *= vec3(xDepthWeight, yDepthWeight, zDepthWeight);
  float weightSum = weight.x + weight.y + weight.z;
  if (weightSum <= 0.0001) {
    return vec4(vec3(0.0), 1.0);
  }
  float shadow = (xMask * weight.x + yMask * weight.y + zMask * weight.z) / weightSum;
  vec3 surfaceLight = (xLight * weight.x + yLight * weight.y + zLight * weight.z) / weightSum;
  return vec4(surfaceLight, shadow);
}
#endif

#if defined(IVOL_PBR) || defined(IVOL_DETAIL_PBR)
struct ivolSampleOut {
  vec3 sh0;
  vec3 sh1;
  vec3 sh2;
  vec3 sh3;
  vec3 sh4;
  vec3 sh5;
  vec3 sh6;
  vec3 sh7;
  vec3 sh8;
  vec3 directionToLight;
  float dominantIntensity;
  float visibility;
  float proximity;
  float relocationStrength;
};

struct ivolCornerWeights {
  float w000;
  float w100;
  float w010;
  float w110;
  float w001;
  float w101;
  float w011;
  float w111;
};

float ivolLuminance(vec3 value) {
  return dot(value, vec3(0.2126, 0.7152, 0.0722));
}

vec3 ivolDominantDirection(vec3 sh1, vec3 sh2, vec3 sh3) {
  vec3 direction = vec3(ivolLuminance(sh1), ivolLuminance(sh2), ivolLuminance(sh3));
  float lengthSquared = dot(direction, direction);
  return lengthSquared > 0.000001 ? normalize(direction) : vec3(0.0, 1.0, 0.0);
}

vec3 ivolEvaluateDirectionalIrradiance(ivolSampleOut sampleValue, vec3 normal) {
  vec3 n = normalize(normal);
  vec3 l1 = sampleValue.sh1 * n.x + sampleValue.sh2 * n.y + sampleValue.sh3 * n.z;
  vec3 l2 =
    sampleValue.sh4 * (n.x * n.y) +
    sampleValue.sh5 * (n.y * n.z) +
    sampleValue.sh6 * (3.0 * n.z * n.z - 1.0) +
    sampleValue.sh7 * (n.x * n.z) +
    sampleValue.sh8 * (n.x * n.x - n.y * n.y);
  vec3 rawIrradiance = sampleValue.sh0 + l1 * 0.46 + l2 * 0.18;
  vec3 minIrradiance = max(sampleValue.sh0 * 0.18, vec3(0.006));
  vec3 maxIrradiance = max(sampleValue.sh0 * 3.5, minIrradiance + vec3(0.0001));
  return clamp(rawIrradiance, minIrradiance, maxIrradiance);
}

vec3 ivolEvaluateSpecularIrradiance(ivolSampleOut sampleValue, vec3 reflectionDirection, float roughness) {
  vec3 reflection = normalize(reflectionDirection);
  float roughBlend = smoothstep(0.18, 0.92, roughness);
  vec3 directional = ivolEvaluateDirectionalIrradiance(sampleValue, reflection);
  float dominantAlignment = pow(saturate(dot(reflection, sampleValue.directionToLight)), mix(72.0, 4.0, roughBlend));
  vec3 dominantLobe = sampleValue.sh0 * sampleValue.dominantIntensity * dominantAlignment;
  return mix(directional + dominantLobe, sampleValue.sh0, roughBlend * 0.78);
}

vec3 ivolSmoothInterpolation(vec3 t) {
  return t * t * (vec3(3.0) - 2.0 * t);
}

float ivolProbeNormalBias(vec3 boundsMin, vec3 boundsMax, vec3 resolution) {
  vec3 cellSize = (boundsMax - boundsMin) / max(resolution - vec3(1.0), vec3(1.0));
  float largestCell = max(max(cellSize.x, cellSize.y), cellSize.z);
  return clamp(largestCell * 0.32, 0.015, 0.18);
}

float ivolLeakGuard(ivolSampleOut sampleValue) {
  float visibility = smoothstep(0.12, 0.92, sampleValue.visibility);
  float proximity = smoothstep(0.06, 0.42, sampleValue.proximity);
  float relocation = mix(1.0, 0.84, sampleValue.relocationStrength);
  return clamp(mix(0.58, 1.0, visibility * proximity) * relocation, 0.50, 1.0);
}

vec2 ivolPackedProbeUv(vec3 resolution, float x, float y, float z) {
  float row = y + z * resolution.y;
  vec2 atlasSize = vec2(resolution.x, resolution.y * resolution.z);
  return (vec2(x, row) + vec2(0.5)) / atlasSize;
}

#ifdef IVOL_PBR
vec4 ivolReadBasePackedProbe(vec3 resolution, float x, float y, float z) {
  return texture(ivolSh0Texture, ivolPackedProbeUv(resolution, x, y, z));
}

vec4 ivolSampleBasePackedTexture(vec3 resolution, vec3 probe0, vec3 probe1, vec3 t) {
  vec4 p000 = ivolReadBasePackedProbe(resolution, probe0.x, probe0.y, probe0.z);
  vec4 p100 = ivolReadBasePackedProbe(resolution, probe1.x, probe0.y, probe0.z);
  vec4 p010 = ivolReadBasePackedProbe(resolution, probe0.x, probe1.y, probe0.z);
  vec4 p110 = ivolReadBasePackedProbe(resolution, probe1.x, probe1.y, probe0.z);
  vec4 p001 = ivolReadBasePackedProbe(resolution, probe0.x, probe0.y, probe1.z);
  vec4 p101 = ivolReadBasePackedProbe(resolution, probe1.x, probe0.y, probe1.z);
  vec4 p011 = ivolReadBasePackedProbe(resolution, probe0.x, probe1.y, probe1.z);
  vec4 p111 = ivolReadBasePackedProbe(resolution, probe1.x, probe1.y, probe1.z);
  vec4 p00 = mix(p000, p100, t.x);
  vec4 p10 = mix(p010, p110, t.x);
  vec4 p01 = mix(p001, p101, t.x);
  vec4 p11 = mix(p011, p111, t.x);
  return mix(mix(p00, p10, t.y), mix(p01, p11, t.y), t.z);
}
#endif

#ifdef IVOL_DETAIL_PBR
float ivolProbeTrust(vec4 metadata, vec4 relocation) {
  float visibility = smoothstep(0.10, 0.88, clamp(metadata.r, 0.0, 1.0));
  float proximity = smoothstep(0.05, 0.36, clamp(metadata.g, 0.0, 1.0));
  float relocationTrust = mix(1.0, 0.62, clamp(relocation.g, 0.0, 1.0));
  return mix(0.08, 1.0, visibility * proximity) * relocationTrust;
}

ivolCornerWeights ivolComputeCornerWeights(sampler2D metadataTexture, sampler2D relocationTexture, vec3 resolution, vec3 probe0, vec3 probe1, vec3 t) {
  vec4 m000 = ivolReadPackedProbe(metadataTexture, resolution, probe0.x, probe0.y, probe0.z);
  vec4 m100 = ivolReadPackedProbe(metadataTexture, resolution, probe1.x, probe0.y, probe0.z);
  vec4 m010 = ivolReadPackedProbe(metadataTexture, resolution, probe0.x, probe1.y, probe0.z);
  vec4 m110 = ivolReadPackedProbe(metadataTexture, resolution, probe1.x, probe1.y, probe0.z);
  vec4 m001 = ivolReadPackedProbe(metadataTexture, resolution, probe0.x, probe0.y, probe1.z);
  vec4 m101 = ivolReadPackedProbe(metadataTexture, resolution, probe1.x, probe0.y, probe1.z);
  vec4 m011 = ivolReadPackedProbe(metadataTexture, resolution, probe0.x, probe1.y, probe1.z);
  vec4 m111 = ivolReadPackedProbe(metadataTexture, resolution, probe1.x, probe1.y, probe1.z);
  vec4 r000 = ivolReadPackedProbe(relocationTexture, resolution, probe0.x, probe0.y, probe0.z);
  vec4 r100 = ivolReadPackedProbe(relocationTexture, resolution, probe1.x, probe0.y, probe0.z);
  vec4 r010 = ivolReadPackedProbe(relocationTexture, resolution, probe0.x, probe1.y, probe0.z);
  vec4 r110 = ivolReadPackedProbe(relocationTexture, resolution, probe1.x, probe1.y, probe0.z);
  vec4 r001 = ivolReadPackedProbe(relocationTexture, resolution, probe0.x, probe0.y, probe1.z);
  vec4 r101 = ivolReadPackedProbe(relocationTexture, resolution, probe1.x, probe0.y, probe1.z);
  vec4 r011 = ivolReadPackedProbe(relocationTexture, resolution, probe0.x, probe1.y, probe1.z);
  vec4 r111 = ivolReadPackedProbe(relocationTexture, resolution, probe1.x, probe1.y, probe1.z);
  vec3 invT = vec3(1.0) - t;
  float b000 = invT.x * invT.y * invT.z;
  float b100 = t.x * invT.y * invT.z;
  float b010 = invT.x * t.y * invT.z;
  float b110 = t.x * t.y * invT.z;
  float b001 = invT.x * invT.y * t.z;
  float b101 = t.x * invT.y * t.z;
  float b011 = invT.x * t.y * t.z;
  float b111 = t.x * t.y * t.z;
  ivolCornerWeights result;
  result.w000 = b000 * ivolProbeTrust(m000, r000);
  result.w100 = b100 * ivolProbeTrust(m100, r100);
  result.w010 = b010 * ivolProbeTrust(m010, r010);
  result.w110 = b110 * ivolProbeTrust(m110, r110);
  result.w001 = b001 * ivolProbeTrust(m001, r001);
  result.w101 = b101 * ivolProbeTrust(m101, r101);
  result.w011 = b011 * ivolProbeTrust(m011, r011);
  result.w111 = b111 * ivolProbeTrust(m111, r111);
  float weightSum = result.w000 + result.w100 + result.w010 + result.w110 + result.w001 + result.w101 + result.w011 + result.w111;
  float invWeightSum = 1.0 / max(weightSum, 0.0001);
  result.w000 *= invWeightSum;
  result.w100 *= invWeightSum;
  result.w010 *= invWeightSum;
  result.w110 *= invWeightSum;
  result.w001 *= invWeightSum;
  result.w101 *= invWeightSum;
  result.w011 *= invWeightSum;
  result.w111 *= invWeightSum;
  return result;
}

vec4 ivolSamplePackedTextureWeighted(sampler2D sourceTexture, vec3 resolution, vec3 probe0, vec3 probe1, ivolCornerWeights weights) {
  return
    ivolReadPackedProbe(sourceTexture, resolution, probe0.x, probe0.y, probe0.z) * weights.w000 +
    ivolReadPackedProbe(sourceTexture, resolution, probe1.x, probe0.y, probe0.z) * weights.w100 +
    ivolReadPackedProbe(sourceTexture, resolution, probe0.x, probe1.y, probe0.z) * weights.w010 +
    ivolReadPackedProbe(sourceTexture, resolution, probe1.x, probe1.y, probe0.z) * weights.w110 +
    ivolReadPackedProbe(sourceTexture, resolution, probe0.x, probe0.y, probe1.z) * weights.w001 +
    ivolReadPackedProbe(sourceTexture, resolution, probe1.x, probe0.y, probe1.z) * weights.w101 +
    ivolReadPackedProbe(sourceTexture, resolution, probe0.x, probe1.y, probe1.z) * weights.w011 +
    ivolReadPackedProbe(sourceTexture, resolution, probe1.x, probe1.y, probe1.z) * weights.w111;
}
#endif

ivolSampleOut ivolDecodePackedSh(vec4 p0, vec4 p1, vec4 p2, vec4 p3, vec4 p4, vec4 p5, vec4 p6, vec4 p7, vec4 p8) {
  ivolSampleOut result;
  result.sh0 = max(p0.rgb, vec3(0.0));
  result.sh1 = vec3(p0.a, p1.r, p1.g);
  result.sh2 = vec3(p1.b, p1.a, p2.r);
  result.sh3 = vec3(p2.g, p2.b, p2.a);
  result.sh4 = p3.rgb;
  result.sh5 = vec3(p3.a, p4.r, p4.g);
  result.sh6 = vec3(p4.b, p4.a, p5.r);
  result.sh7 = vec3(p5.g, p5.b, p5.a);
  result.sh8 = p6.rgb;
  result.directionToLight = ivolDominantDirection(result.sh1, result.sh2, result.sh3);
  result.dominantIntensity = max(p6.a, 0.0);
  result.visibility = clamp(p7.r, 0.0, 1.0);
  result.proximity = clamp(p7.g, 0.0, 1.0);
  result.relocationStrength = clamp(p8.g, 0.0, 1.0);
  return result;
}
#endif

#ifdef IVOL_PBR
ivolSampleOut ivolSample(vec3 worldPosition) {
  vec3 volumeSize = max(ivolMax - ivolMin, vec3(0.0001));
  vec3 local = clamp((worldPosition - ivolMin) / volumeSize, vec3(0.0), vec3(1.0));
  vec3 probe = local * max(ivolResolution - vec3(1.0), vec3(0.0));
  vec3 probe0 = floor(probe);
  vec3 probe1 = min(probe0 + vec3(1.0), ivolResolution - vec3(1.0));
  vec3 t = ivolSmoothInterpolation(clamp(probe - probe0, vec3(0.0), vec3(1.0)));
  vec4 p0 = ivolSampleBasePackedTexture(ivolResolution, probe0, probe1, t);
  ivolSampleOut result;
  result.sh0 = max(p0.rgb, vec3(0.0));
  result.sh1 = vec3(0.0);
  result.sh2 = vec3(0.0);
  result.sh3 = vec3(0.0);
  result.sh4 = vec3(0.0);
  result.sh5 = vec3(0.0);
  result.sh6 = vec3(0.0);
  result.sh7 = vec3(0.0);
  result.sh8 = vec3(0.0);
  result.directionToLight = vec3(0.0, 1.0, 0.0);
  result.dominantIntensity = 0.0;
  result.visibility = 1.0;
  result.proximity = 1.0;
  result.relocationStrength = 0.0;
  return result;
}
#endif

#ifdef IVOL_DETAIL_PBR
ivolSampleOut ivolDetailSample(vec3 worldPosition) {
  vec3 volumeSize = max(ivolDetailMax - ivolDetailMin, vec3(0.0001));
  vec3 local = clamp((worldPosition - ivolDetailMin) / volumeSize, vec3(0.0), vec3(1.0));
  vec3 probe = local * max(ivolDetailResolution - vec3(1.0), vec3(0.0));
  vec3 probe0 = floor(probe);
  vec3 probe1 = min(probe0 + vec3(1.0), ivolDetailResolution - vec3(1.0));
  vec3 t = ivolSmoothInterpolation(clamp(probe - probe0, vec3(0.0), vec3(1.0)));
  ivolCornerWeights weights = ivolComputeCornerWeights(ivolDetailSh7Texture, ivolDetailSh8Texture, ivolDetailResolution, probe0, probe1, t);

  return ivolDecodePackedSh(
    ivolSamplePackedTextureWeighted(ivolDetailSh0Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh1Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh2Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh3Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh4Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh5Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh6Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh7Texture, ivolDetailResolution, probe0, probe1, weights),
    ivolSamplePackedTextureWeighted(ivolDetailSh8Texture, ivolDetailResolution, probe0, probe1, weights)
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
#ifdef STATIC_SHADOW_MASK
vec3 staticShadowMaskPosition = vPositionW;
#endif
#ifdef IVOL_PBR
float ivolBias = ivolProbeNormalBias(ivolMin, ivolMax, ivolResolution);
#ifdef IVOL_DETAIL_PBR
ivolBias = min(ivolBias, ivolProbeNormalBias(ivolDetailMin, ivolDetailMax, ivolDetailResolution));
#endif
vec3 ivolSamplePosition = vPositionW + normalW * ivolBias;
ivolSampleOut ivol = ivolSample(ivolSamplePosition);
#ifdef IVOL_DETAIL_PBR
ivolSampleOut ivolDetail = ivolDetailSample(ivolSamplePosition);
float ivolDetailWeight = ivolDetailBlend(ivolSamplePosition);
ivol.sh0 = mix(ivol.sh0, ivolDetail.sh0, ivolDetailWeight);
ivol.sh1 = mix(ivol.sh1, ivolDetail.sh1, ivolDetailWeight);
ivol.sh2 = mix(ivol.sh2, ivolDetail.sh2, ivolDetailWeight);
ivol.sh3 = mix(ivol.sh3, ivolDetail.sh3, ivolDetailWeight);
ivol.sh4 = mix(ivol.sh4, ivolDetail.sh4, ivolDetailWeight);
ivol.sh5 = mix(ivol.sh5, ivolDetail.sh5, ivolDetailWeight);
ivol.sh6 = mix(ivol.sh6, ivolDetail.sh6, ivolDetailWeight);
ivol.sh7 = mix(ivol.sh7, ivolDetail.sh7, ivolDetailWeight);
ivol.sh8 = mix(ivol.sh8, ivolDetail.sh8, ivolDetailWeight);
ivol.directionToLight = normalize(mix(ivol.directionToLight, ivolDetail.directionToLight, ivolDetailWeight));
ivol.dominantIntensity = mix(ivol.dominantIntensity, ivolDetail.dominantIntensity, ivolDetailWeight);
ivol.visibility = mix(ivol.visibility, ivolDetail.visibility, ivolDetailWeight);
ivol.proximity = mix(ivol.proximity, ivolDetail.proximity, ivolDetailWeight);
ivol.relocationStrength = mix(ivol.relocationStrength, ivolDetail.relocationStrength, ivolDetailWeight);
#endif
float ivolAmbientEnergy = max(dot(ivol.sh0, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
float ivolDirectRatio = clamp(ivol.dominantIntensity / ivolAmbientEnergy, 0.0, 0.92);
float ivolNdotL = saturate(dot(normalW, ivol.directionToLight));
float ivolVisibilityGuard = mix(1.0, ivolLeakGuard(ivol), ivolDynamicReceiverShadow);
vec3 ivolDirectionalRadiance = ivolEvaluateDirectionalIrradiance(ivol, normalW) * ivolVisibilityGuard;
vec3 ivolAmbientRadiance = max(ivol.sh0 * mix(0.32, 0.72, ivol.visibility), vec3(0.006));
vec3 ivolRadiance = max(ivolDirectionalRadiance, ivolAmbientRadiance);
float ivolEffectiveIntensity = ivolIntensityResponse(ivolIntensity);
float ivolStaticShadow = 1.0;
vec3 ivolStaticSurfaceLight = vec3(0.0);
float ivolStaticSurfaceWeight = 0.0;
#ifdef STATIC_SHADOW_MASK
vec4 staticShadowAndLight = staticShadowAndLightSample(staticShadowMaskPosition, normalW);
ivolStaticShadow = mix(0.65, 1.0, staticShadowAndLight.a);
ivolStaticSurfaceLight = staticShadowAndLight.rgb;
ivolStaticSurfaceWeight = smoothstep(0.003, 0.055, ivolLuminance(ivolStaticSurfaceLight));
#endif
ivolRadiance *= ivolStaticShadow;
vec3 ivolShadowedAmbientRadiance = ivolAmbientRadiance * ivolStaticShadow;
vec3 ivolF0 = clamp(vec3(reflectanceF0), vec3(0.0), vec3(1.0));
float ivolF0Energy = clamp(dot(ivolF0, vec3(0.2126, 0.7152, 0.0722)), 0.0, 0.95);
float ivolDiffuseEnergy = clamp(1.0 - ivolF0Energy * (1.0 - roughness * 0.55), 0.08, 1.0);
vec3 ivolSurfaceTint = max(surfaceAlbedo, vec3(0.08));
vec3 ivolDiffuseRadiance = ivolCompressRadiance(ivolRadiance * ivolEffectiveIntensity);
vec3 ivolAmbientFill = ivolCompressRadiance(ivolShadowedAmbientRadiance * ivolEffectiveIntensity);
#ifdef STATIC_SHADOW_MASK
vec3 ivolStaticSurfaceRadiance = ivolCompressRadiance(ivolStaticSurfaceLight * 1.15);
ivolDiffuseRadiance = mix(ivolDiffuseRadiance * 0.68, ivolStaticSurfaceRadiance, ivolStaticSurfaceWeight);
ivolAmbientFill *= 1.0 - ivolStaticSurfaceWeight * 0.78;
#endif
finalDiffuse += ivolDiffuseRadiance * ivolSurfaceTint * ivolDiffuseEnergy;
finalEmissive += ivolAmbientFill * ivolSurfaceTint * 0.01;
#endif
#if defined(STATIC_SHADOW_MASK) && !defined(IVOL_PBR)
vec4 staticShadowAndLight = staticShadowAndLightSample(staticShadowMaskPosition, normalW);
vec3 staticBakedRadiance = ivolCompressRadiance(staticShadowAndLight.rgb * 1.15);
vec3 staticSurfaceTint = max(surfaceAlbedo, vec3(0.08));
finalDiffuse += staticBakedRadiance * staticSurfaceTint;
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
  assertTextureDimensions(scene, width, height, 'IVOL SH atlas')
  warnTextureBudget('IVOL SH atlases', estimateIrradianceVolumeGpuBytes(volume), 192 * 1024 * 1024)
  const shAtlases = Array.from({ length: 9 }, () => new Float32Array(width * height * 4))

  for (let z = 0; z < zCount; z += 1) {
    for (let y = 0; y < yCount; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = probeIndex(x, y, z, volume.resolution)
        const targetIndex = (x + (y + z * yCount) * width) * 4
        const packed = readPackedShPayload(volume, sourceIndex)

        for (let atlasIndex = 0; atlasIndex < shAtlases.length; atlasIndex += 1) {
          const atlas = shAtlases[atlasIndex]
          const packedBase = atlasIndex * 4

          atlas[targetIndex] = packed[packedBase]
          atlas[targetIndex + 1] = packed[packedBase + 1]
          atlas[targetIndex + 2] = packed[packedBase + 2]
          atlas[targetIndex + 3] = packed[packedBase + 3]
        }
      }
    }
  }

  const shTextures = shAtlases.map((atlas, index) =>
    createVolumeAtlasTexture(scene, atlas, width, height, `ivol-sh${index}`))

  return {
    shTextures,
    boundsMin: new Vector3(volume.bounds.min[0], volume.bounds.min[1], volume.bounds.min[2]),
    boundsMax: new Vector3(volume.bounds.max[0], volume.bounds.max[1], volume.bounds.max[2]),
    resolution: new Vector3(volume.resolution[0], volume.resolution[1], volume.resolution[2]),
  }
}

const createVolumeAtlasTexture = (
  scene: Scene,
  data: Float32Array,
  width: number,
  height: number,
  name: string,
): RawTexture => {
  const texture = RawTexture.CreateRGBATexture(
    data,
    width,
    height,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_FLOAT,
  )

  texture.name = `${name}-${width}x${height}`
  texture.wrapU = Texture.CLAMP_ADDRESSMODE
  texture.wrapV = Texture.CLAMP_ADDRESSMODE

  return texture
}

export const createStaticShadowMaskTexture = (
  scene: Scene,
  mask: StaticShadowMask,
): StaticShadowMaskTexture => {
  const atlasHeight = mask.height * mask.planeCount
  assertTextureDimensions(scene, mask.width, atlasHeight, 'static shadowmask atlas')
  const useCompactTextures = false
  warnTextureBudget(
    'static shadowmask/lightmap atlases',
    estimateStaticShadowMaskGpuBytes(mask, useCompactTextures),
    512 * 1024 * 1024,
  )
  const texture = useCompactTextures
    ? RawTexture.CreateRTexture(
      mask.payload,
      mask.width,
      atlasHeight,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    )
    : RawTexture.CreateRGBATexture(
      expandScalarToRgba(mask.payload),
      mask.width,
      atlasHeight,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    )
  texture.name = `static-shadowmask-${mask.width}x${mask.height}x${mask.planeCount}`
  texture.wrapU = Texture.CLAMP_ADDRESSMODE
  texture.wrapV = Texture.CLAMP_ADDRESSMODE

  const lightTexture = useCompactTextures
    ? RawTexture.CreateRGBTexture(
      mask.lightPayload,
      mask.width,
      atlasHeight,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    )
    : RawTexture.CreateRGBATexture(
      expandRgbToRgba(mask.lightPayload),
      mask.width,
      atlasHeight,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    )
  lightTexture.name = `static-surface-light-${mask.width}x${mask.height}x${mask.planeCount}`
  lightTexture.wrapU = Texture.CLAMP_ADDRESSMODE
  lightTexture.wrapV = Texture.CLAMP_ADDRESSMODE

  const depthTexture = useCompactTextures
    ? RawTexture.CreateRTexture(
      mask.depthPayload,
      mask.width,
      atlasHeight,
      scene,
      false,
      false,
      Texture.NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    )
    : RawTexture.CreateRGBATexture(
      expandScalarToRgba(mask.depthPayload),
      mask.width,
      atlasHeight,
      scene,
      false,
      false,
      Texture.NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_FLOAT,
    )
  depthTexture.name = `static-surface-depth-${mask.width}x${mask.height}x${mask.planeCount}`
  depthTexture.wrapU = Texture.CLAMP_ADDRESSMODE
  depthTexture.wrapV = Texture.CLAMP_ADDRESSMODE

  return {
    texture,
    lightTexture,
    depthTexture,
    boundsMin: new Vector3(mask.bounds.min[0], mask.bounds.min[1], mask.bounds.min[2]),
    boundsMax: new Vector3(mask.bounds.max[0], mask.bounds.max[1], mask.bounds.max[2]),
    planeCount: mask.planeCount,
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
  detailResource: IrradianceVolumeTexture | null = null,
): void => {
  for (const plugin of plugins) {
    plugin.intensity = intensity
    plugin.setVolume(resource)
    plugin.setDetailVolume(detailResource)
  }
}

export const updateIrradianceVolumeDetailPlugins = (
  plugins: IrradianceVolumePbrPlugin[],
  resource: IrradianceVolumeTexture | null,
): void => {
  for (const plugin of plugins) {
    plugin.setDetailVolume(resource)
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

export const setIrradianceVolumeDynamicReceiverShadow = (
  plugins: IrradianceVolumePbrPlugin[],
  intensity: number,
): void => {
  for (const plugin of plugins) {
    plugin.dynamicReceiverShadow = intensity
  }
}

export const updateStaticShadowMaskPlugins = (
  plugins: IrradianceVolumePbrPlugin[],
  resource: StaticShadowMaskTexture | null,
): void => {
  for (const plugin of plugins) {
    plugin.setStaticShadowMask(resource)
  }
}

export const estimateIrradianceVolumeGpuBytes = (volume: LoadedVolume): number =>
  volume.resolution[0] * volume.resolution[1] * volume.resolution[2] * IVOL_PROBE_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT

export const estimateStaticShadowMaskGpuBytes = (mask: StaticShadowMask, compact = true): number =>
  mask.width * mask.height * mask.planeCount * (compact ? 5 : 12) * Float32Array.BYTES_PER_ELEMENT

const assertTextureDimensions = (scene: Scene, width: number, height: number, label: string): void => {
  const caps = scene.getEngine().getCaps() as { maxTextureSize?: number }
  const maxTextureSize = caps.maxTextureSize ?? 16384

  if (width > maxTextureSize || height > maxTextureSize) {
    throw new Error(`${label} ${width}x${height} exceeds max texture size ${maxTextureSize}. Lower the bake resolution or split the atlas.`)
  }
}

const warnTextureBudget = (label: string, bytes: number, warningBytes: number): void => {
  if (bytes > warningBytes) {
    console.warn(`${label} uses approximately ${(bytes / (1024 * 1024)).toFixed(1)} MiB of float texture memory.`)
  }
}

const expandScalarToRgba = (source: Float32Array): Float32Array => {
  const output = new Float32Array(source.length * 4)

  for (let index = 0; index < source.length; index += 1) {
    const base = index * 4
    const value = source[index]

    output[base] = value
    output[base + 1] = value
    output[base + 2] = value
    output[base + 3] = 1
  }

  return output
}

const expandRgbToRgba = (source: Float32Array): Float32Array => {
  const texelCount = Math.floor(source.length / 3)
  const output = new Float32Array(texelCount * 4)

  for (let index = 0; index < texelCount; index += 1) {
    const sourceBase = index * 3
    const targetBase = index * 4

    output[targetBase] = source[sourceBase]
    output[targetBase + 1] = source[sourceBase + 1]
    output[targetBase + 2] = source[sourceBase + 2]
    output[targetBase + 3] = 1
  }

  return output
}

const isPbrMaterial = (material: Material): boolean => {
  const className = material.getClassName()

  return className.includes('PBR')
}

const bindFirstShTexture = (
  uniformBuffer: UniformBuffer,
  prefix: string,
  textures: RawTexture[],
): void => {
  const texture = textures[0]
  if (texture) {
    uniformBuffer.setTexture(`${prefix}0Texture`, texture)
  }
}

const readPackedShPayload = (volume: LoadedVolume, index: number): number[] => {
  if ('kind' in volume) {
    const base = index * IVOL_PROBE_STRIDE_FLOATS

    return [
      volume.payload[base],
      volume.payload[base + 1],
      volume.payload[base + 2],
      volume.payload[base + 3],
      volume.payload[base + 4],
      volume.payload[base + 5],
      volume.payload[base + 6],
      volume.payload[base + 7],
      volume.payload[base + 8],
      volume.payload[base + 9],
      volume.payload[base + 10],
      volume.payload[base + 11],
      volume.payload[base + 12],
      volume.payload[base + 13],
      volume.payload[base + 14],
      volume.payload[base + 15],
      volume.payload[base + 16],
      volume.payload[base + 17],
      volume.payload[base + 18],
      volume.payload[base + 19],
      volume.payload[base + 20],
      volume.payload[base + 21],
      volume.payload[base + 22],
      volume.payload[base + 23],
      volume.payload[base + 24],
      volume.payload[base + 25],
      volume.payload[base + 26],
      volume.payload[base + 27],
      volume.payload[base + 28],
      volume.payload[base + 29],
      volume.payload[base + 30],
      volume.payload[base + 31],
      volume.payload[base + 32],
      volume.payload[base + 33],
      volume.payload[base + 34],
      volume.payload[base + 35],
    ]
  }

  const probe = volume.probes[index]
  const ambient = probe.ambient
  const direction = normalizeTuple(probe.dominantDirection)
  const packed = new Array<number>(36).fill(0)
  const addCoeff = (coefficientIndex: number, value: Vec3Tuple): void => {
    const offset = coefficientIndex * 3
    packed[offset] = value[0]
    packed[offset + 1] = value[1]
    packed[offset + 2] = value[2]
  }
  const scaled = (scale: number): Vec3Tuple => [
    ambient[0] * scale,
    ambient[1] * scale,
    ambient[2] * scale,
  ]

  addCoeff(0, ambient)
  addCoeff(1, scaled(direction[0]))
  addCoeff(2, scaled(direction[1]))
  addCoeff(3, scaled(direction[2]))
  addCoeff(4, scaled(direction[0] * direction[1]))
  addCoeff(5, scaled(direction[1] * direction[2]))
  addCoeff(6, scaled(3 * direction[2] * direction[2] - 1))
  addCoeff(7, scaled(direction[0] * direction[2]))
  addCoeff(8, scaled(direction[0] * direction[0] - direction[1] * direction[1]))
  packed[27] = Math.max(0, probe.dominantIntensity)
  packed[28] = 1
  packed[29] = 1
  packed[34] = 1
  packed[35] = 1

  return packed
}

const normalizeTuple = (tuple: Vec3Tuple): Vec3Tuple => {
  const length = Math.hypot(tuple[0], tuple[1], tuple[2])

  if (length < 0.00001) {
    return [0, 1, 0]
  }

  return [tuple[0] / length, tuple[1] / length, tuple[2] / length]
}
