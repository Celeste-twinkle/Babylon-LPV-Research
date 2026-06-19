const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/kernelBlur.fragment-DGoy5K5D.js","assets/shaderStore-D-XQlhUT.js","assets/kernelBlurVaryingDeclaration-g2Ge9lzd.js","assets/packingFunctions-CINwVZs6.js","assets/kernelBlur.vertex-Cr8ljakh.js","assets/kernelBlur.fragment-BvT73mHN.js","assets/kernelBlurVaryingDeclaration-DP2Wr9Oc.js","assets/packingFunctions-DpGwbupU.js","assets/kernelBlur.vertex-C2dESVl-.js","assets/shadowMap.fragment-DUFTmQJ_.js","assets/clipPlaneFragment-Ct2VqHzk.js","assets/shadowMap.vertex-CCycMdLk.js","assets/clipPlaneVertex-Bxgq6IpG.js","assets/helperFunctions-s1JcGifL.js","assets/meshUboDeclaration-BATNZvmb.js","assets/morphTargetsVertex-OlIh-Lzh.js","assets/sceneUboDeclaration-B96Tfx7b.js","assets/depthBoxBlur.fragment-D2KJPEQv.js","assets/shadowMapFragmentSoftTransparentShadow-B6k0i9Au.js","assets/shadowMap.fragment-DX4Yo1bp.js","assets/clipPlaneFragment-DVK0wgyZ.js","assets/shadowMap.vertex-CMpfNXd4.js","assets/clipPlaneVertex-Cqy6RCeP.js","assets/helperFunctions-BXbvU0Ia.js","assets/meshUboDeclaration-BmNu2KU_.js","assets/morphTargetsVertex-6N5r7oF1.js","assets/sceneUboDeclaration-B5VhSG0v.js","assets/sceneVertexDeclaration-CluTp-RC.js","assets/depthBoxBlur.fragment-CLEAG5DG.js","assets/shadowMapFragmentSoftTransparentShadow-R_iOKnyx.js"])))=>i.map(i=>d[i]);
import{a as e,i as t,o as n,t as r}from"./math.vector.pure-D3Yk2YK3.js";import{n as i,t as a}from"./math.color.pure-_GxBM3om.js";import"./math.color-BSJGaPKM.js";import{a as o,t as s}from"./observable.pure-WBWqA1Qn.js";import{t as c}from"./engineStore-C7OguShv.js";import{n as l}from"./math.size-CvFwYfiX.js";import{E as u,S as d,T as f,a as p,b as m,d as h,i as g,m as _,p as v,r as y,y as ee}from"./irradianceBakeBundle-B4qs1gAW.js";import{_ as b,i as x,m as te}from"./decorators-BOtej2xA.js";import{t as S}from"./renderingManager-CbVC4AoW.js";import{n as ne}from"./effectRenderer.pure-CS6MCYoh.js";import{r as C}from"./buffer.pure-CNnuMtRn.js";import{A as re,M as ie,N as ae,P as oe,_ as se,l as ce,r as le,t as ue,u as de}from"./material.pure-C_m6QhHJ.js";import{n as fe,t as w}from"./preload-helper-BGudr8Iy.js";import{n as T}from"./texture.pure-BTPaNx8I.js";import{t as E}from"./lightConstants-L3VDms3v.js";import{p as D}from"./glTFLoaderAnimation-DQJ_Fs4w.js";import{i as pe,r as O,t as k}from"./sceneComponent-C6m1npMK.js";import{d as me}from"./imageProcessing-CmERnC_x.js";import{n as he,r as ge}from"./material.detailMapConfiguration-CcQRsMPk.js";import{t as A}from"./constants-FfqMFcYa.js";import{n as j}from"./renderTargetTexture.pure-yBF9IFGU.js";import{n as M}from"./textureTools-BS2Xqxzy.js";import{t as _e}from"./pbrMaterial-CfPkzdfn.js";import{t as ve}from"./baseTexture.polynomial.pure-CyIKFXhK.js";ve(),ge();var N;(function(e){e[e.GLSL=0]=`GLSL`,e[e.WGSL=1]=`WGSL`})(N||={});var ye=class extends he{_resource=null;_detailResource=null;_shadowMask=null;_intensity=1;_dynamicReceiverShadow=1;constructor(e){super(e,`IrradianceVolumePbr`,210,{IVOL_PBR:!1,IVOL_DETAIL_PBR:!1,STATIC_SHADOW_MASK:!1})}get intensity(){return this._intensity}set intensity(e){this._intensity=Math.max(0,e)}get dynamicReceiverShadow(){return this._dynamicReceiverShadow}set dynamicReceiverShadow(e){this._dynamicReceiverShadow=Math.min(1,Math.max(0,Number.isFinite(e)?e:1))}setVolume(e){let t=this._resource!==null||this._detailResource!==null;this._resource=e;let n=e!==null||this._detailResource!==null;(t!==n||this._shadowMask!==null)&&this._enable(n||this._shadowMask!==null),this.markAllDefinesAsDirty()}setDetailVolume(e){let t=this._resource!==null||this._detailResource!==null;this._detailResource=e;let n=this._resource!==null||e!==null;(t!==n||this._shadowMask!==null)&&this._enable(n||this._shadowMask!==null),this.markAllDefinesAsDirty()}setStaticShadowMask(e){let t=this._shadowMask!==null;this._shadowMask=e;let n=e!==null,r=this._resource!==null||this._detailResource!==null;(t!==n||r)&&this._enable(n||r),this.markAllDefinesAsDirty()}isCompatible(e){return e===N.GLSL}isReadyForSubMesh(){let e=this.getSequentialDetailResource();return(this._resource?.shTextures[0]?.isReady()??!0)&&(e?.shTextures[0]?.isReady()??!0)&&(this._shadowMask?.texture.isReady()??!0)&&(this._shadowMask?.lightTexture.isReady()??!0)&&(this._shadowMask?.depthTexture.isReady()??!0)}prepareDefines(e){let t=e,n=this.getSequentialDetailResource();t.IVOL_PBR=this._resource!==null||n!==null,t.IVOL_DETAIL_PBR=this._resource!==null&&n!==null,t.STATIC_SHADOW_MASK=this._shadowMask!==null}bindForSubMesh(e,t,n,r){if(!this._resource&&!this._detailResource&&!this._shadowMask)return;let i=this.getSequentialDetailResource(),a=this._resource??i;if(a&&(e.updateVector3(`ivolMin`,a.boundsMin),e.updateVector3(`ivolMax`,a.boundsMax),e.updateVector3(`ivolResolution`,a.resolution),e.updateFloat(`ivolIntensity`,this._intensity),e.updateFloat(`ivolDynamicReceiverShadow`,this._dynamicReceiverShadow),V(e,`ivolSh`,a.shTextures)),this._resource&&i&&(e.updateVector3(`ivolDetailMin`,i.boundsMin),e.updateVector3(`ivolDetailMax`,i.boundsMax),e.updateVector3(`ivolDetailResolution`,i.resolution),V(e,`ivolDetailSh`,i.shTextures)),this._shadowMask){let t=this._shadowMask.texture.getSize();e.updateVector3(`staticShadowMaskMin`,this._shadowMask.boundsMin),e.updateVector3(`staticShadowMaskMax`,this._shadowMask.boundsMax),e.updateFloat(`staticShadowMaskPlaneCount`,this._shadowMask.planeCount),e.updateFloat2(`staticShadowMaskTextureSize`,t.width,t.height),e.setTexture(`staticShadowMaskTexture`,this._shadowMask.texture),e.setTexture(`staticSurfaceLightTexture`,this._shadowMask.lightTexture),e.setTexture(`staticSurfaceDepthTexture`,this._shadowMask.depthTexture)}}hasTexture(e){let t=this.getSequentialDetailResource();return this._resource?.shTextures[0]===e||t?.shTextures[0]===e||this._shadowMask?.texture===e||this._shadowMask?.lightTexture===e||this._shadowMask?.depthTexture===e}getActiveTextures(e){let t=this.getSequentialDetailResource();this._resource&&e.push(this._resource.shTextures[0]),t&&e.push(t.shTextures[0]),this._shadowMask&&(e.push(this._shadowMask.texture),e.push(this._shadowMask.lightTexture),e.push(this._shadowMask.depthTexture))}getSamplers(e){let t=this.getSequentialDetailResource();(this._resource||t)&&e.push(`ivolSh0Texture`),this._resource&&t&&e.push(`ivolDetailSh0Texture`),this._shadowMask&&e.push(`staticShadowMaskTexture`,`staticSurfaceLightTexture`,`staticSurfaceDepthTexture`)}getUniforms(){return{ubo:[{name:`ivolMin`,size:3,type:`vec3`},{name:`ivolMax`,size:3,type:`vec3`},{name:`ivolResolution`,size:3,type:`vec3`},{name:`ivolIntensity`,size:1,type:`float`},{name:`ivolDynamicReceiverShadow`,size:1,type:`float`},{name:`ivolDetailMin`,size:3,type:`vec3`},{name:`ivolDetailMax`,size:3,type:`vec3`},{name:`ivolDetailResolution`,size:3,type:`vec3`},{name:`staticShadowMaskMin`,size:3,type:`vec3`},{name:`staticShadowMaskMax`,size:3,type:`vec3`},{name:`staticShadowMaskPlaneCount`,size:1,type:`float`},{name:`staticShadowMaskTextureSize`,size:2,type:`vec2`}]}}getSequentialDetailResource(){return null}getCustomCode(e,t=N.GLSL){return e!==`fragment`||t!==N.GLSL?null:{CUSTOM_FRAGMENT_DEFINITIONS:`
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
`,CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION:`
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
`}}},P=(e,t)=>{let[r,i,a]=t.resolution,o=i*a;R(e,r,o,`IVOL SH atlas`),z(`IVOL SH atlases`,Ce(t),192*1024*1024);let s=Array.from({length:9},()=>new Float32Array(r*o*4));for(let e=0;e<a;e+=1)for(let n=0;n<i;n+=1)for(let a=0;a<r;a+=1){let o=ee(a,n,e,t.resolution),c=(a+(n+e*i)*r)*4,l=De(t,o);for(let e=0;e<s.length;e+=1){let t=s[e],n=e*4;t[c]=l[n],t[c+1]=l[n+1],t[c+2]=l[n+2],t[c+3]=l[n+3]}}return{shTextures:s.map((t,n)=>be(e,t,r,o,`ivol-sh${n}`)),boundsMin:new n(t.bounds.min[0],t.bounds.min[1],t.bounds.min[2]),boundsMax:new n(t.bounds.max[0],t.bounds.max[1],t.bounds.max[2]),resolution:new n(t.resolution[0],t.resolution[1],t.resolution[2])}},be=(e,t,n,r,i)=>{let a=v.CreateRGBATexture(t,n,r,e,!1,!1,T.NEAREST_SAMPLINGMODE,A.TEXTURETYPE_FLOAT);return a.name=`${i}-${n}x${r}`,a.wrapU=T.CLAMP_ADDRESSMODE,a.wrapV=T.CLAMP_ADDRESSMODE,a},xe=(e,t)=>{let r=t.height*t.planeCount;R(e,t.width,r,`static shadowmask atlas`),z(`static shadowmask/lightmap atlases`,we(t,!1),512*1024*1024);let i=v.CreateRGBATexture(B(t.payload),t.width,r,e,!1,!1,T.BILINEAR_SAMPLINGMODE,A.TEXTURETYPE_FLOAT);i.name=`static-shadowmask-${t.width}x${t.height}x${t.planeCount}`,i.wrapU=T.CLAMP_ADDRESSMODE,i.wrapV=T.CLAMP_ADDRESSMODE;let a=v.CreateRGBATexture(Te(t.lightPayload),t.width,r,e,!1,!1,T.BILINEAR_SAMPLINGMODE,A.TEXTURETYPE_FLOAT);a.name=`static-surface-light-${t.width}x${t.height}x${t.planeCount}`,a.wrapU=T.CLAMP_ADDRESSMODE,a.wrapV=T.CLAMP_ADDRESSMODE;let o=v.CreateRGBATexture(B(t.depthPayload),t.width,r,e,!1,!1,T.NEAREST_SAMPLINGMODE,A.TEXTURETYPE_FLOAT);return o.name=`static-surface-depth-${t.width}x${t.height}x${t.planeCount}`,o.wrapU=T.CLAMP_ADDRESSMODE,o.wrapV=T.CLAMP_ADDRESSMODE,{texture:i,lightTexture:a,depthTexture:o,boundsMin:new n(t.bounds.min[0],t.bounds.min[1],t.bounds.min[2]),boundsMax:new n(t.bounds.max[0],t.bounds.max[1],t.bounds.max[2]),planeCount:t.planeCount}},F=e=>{let t=new Set;for(let n of e){let e=n.material;e instanceof ue&&Ee(e)&&t.add(e)}return[...t].map(e=>new ye(e))},I=(e,t,n,r=null)=>{for(let i of e)i.intensity=n,i.setVolume(t),i.setDetailVolume(r)},Se=(e,t)=>{for(let n of e)n.intensity=t},L=(e,t)=>{for(let n of e)n.setStaticShadowMask(t)},Ce=e=>e.resolution[0]*e.resolution[1]*e.resolution[2]*36*Float32Array.BYTES_PER_ELEMENT,we=(e,t=!0)=>e.width*e.height*e.planeCount*(t?5:12)*Float32Array.BYTES_PER_ELEMENT,R=(e,t,n,r)=>{let i=e.getEngine().getCaps().maxTextureSize??16384;if(t>i||n>i)throw Error(`${r} ${t}x${n} exceeds max texture size ${i}. Lower the bake resolution or split the atlas.`)},z=(e,t,n)=>{t>n&&console.warn(`${e} uses approximately ${(t/(1024*1024)).toFixed(1)} MiB of float texture memory.`)},B=e=>{let t=new Float32Array(e.length*4);for(let n=0;n<e.length;n+=1){let r=n*4,i=e[n];t[r]=i,t[r+1]=i,t[r+2]=i,t[r+3]=1}return t},Te=e=>{let t=Math.floor(e.length/3),n=new Float32Array(t*4);for(let r=0;r<t;r+=1){let t=r*3,i=r*4;n[i]=e[t],n[i+1]=e[t+1],n[i+2]=e[t+2],n[i+3]=1}return n},Ee=e=>e.getClassName().includes(`PBR`),V=(e,t,n)=>{let r=n[0];r&&e.setTexture(`${t}0Texture`,r)},De=(e,t)=>{if(`kind`in e){let n=t*36;return[e.payload[n],e.payload[n+1],e.payload[n+2],e.payload[n+3],e.payload[n+4],e.payload[n+5],e.payload[n+6],e.payload[n+7],e.payload[n+8],e.payload[n+9],e.payload[n+10],e.payload[n+11],e.payload[n+12],e.payload[n+13],e.payload[n+14],e.payload[n+15],e.payload[n+16],e.payload[n+17],e.payload[n+18],e.payload[n+19],e.payload[n+20],e.payload[n+21],e.payload[n+22],e.payload[n+23],e.payload[n+24],e.payload[n+25],e.payload[n+26],e.payload[n+27],e.payload[n+28],e.payload[n+29],e.payload[n+30],e.payload[n+31],e.payload[n+32],e.payload[n+33],e.payload[n+34],e.payload[n+35]]}let n=e.probes[t],r=n.ambient,i=Oe(n.dominantDirection),a=Array(36).fill(0),o=(e,t)=>{let n=e*3;a[n]=t[0],a[n+1]=t[1],a[n+2]=t[2]},s=e=>[r[0]*e,r[1]*e,r[2]*e];return o(0,r),o(1,s(i[0])),o(2,s(i[1])),o(3,s(i[2])),o(4,s(i[0]*i[1])),o(5,s(i[1]*i[2])),o(6,s(3*i[2]*i[2]-1)),o(7,s(i[0]*i[2])),o(8,s(i[0]*i[0]-i[1]*i[1])),a[27]=Math.max(0,n.dominantIntensity),a[28]=1,a[29]=1,a[34]=1,a[35]=1,a},Oe=e=>{let t=Math.hypot(e[0],e[1],e[2]);return t<1e-5?[0,1,0]:[e[0]/t,e[1]/t,e[2]/t]},H=class e extends ne{_gatherImports(e,t){e?(this._webGPUReady=!0,t.push(Promise.all([w(()=>import(`./kernelBlur.fragment-DGoy5K5D.js`),__vite__mapDeps([0,1,2,3])),w(()=>import(`./kernelBlur.vertex-Cr8ljakh.js`),__vite__mapDeps([4,1,2]))]))):t.push(Promise.all([w(()=>import(`./kernelBlur.fragment-BvT73mHN.js`),__vite__mapDeps([5,1,6,7])),w(()=>import(`./kernelBlur.vertex-C2dESVl-.js`),__vite__mapDeps([8,1,6]))]))}constructor(t,n=null,r,i,a){let o=!!a?.blockCompilation;super({...a,name:t,engine:n||c.LastCreatedEngine,useShaderStore:!0,useAsPostProcess:!0,fragmentShader:e.FragmentUrl,uniforms:e.Uniforms,samplers:e.Samplers,vertexUrl:e.VertexUrl,blockCompilation:!0}),this._packedFloat=!1,this._staticDefines=``,this.textureWidth=0,this.textureHeight=0,this._staticDefines=a?Array.isArray(a.defines)?a.defines.join(`
`):a.defines||``:``,this.options.blockCompilation=o,r!==void 0&&(this.direction=r),i!==void 0&&(this.kernel=i)}set kernel(e){this._idealKernel!==e&&(e=Math.max(e,1),this._idealKernel=e,this._kernel=this._nearestBestKernel(e),this.options.blockCompilation||this._updateParameters())}get kernel(){return this._idealKernel}set packedFloat(e){this._packedFloat!==e&&(this._packedFloat=e,this.options.blockCompilation||this._updateParameters())}get packedFloat(){return this._packedFloat}bind(e=!1){super.bind(e),this._drawWrapper.effect.setFloat2(`delta`,1/this.textureWidth*this.direction.x,1/this.textureHeight*this.direction.y)}_updateParameters(e,t){let n=this._kernel,r=(n-1)/2,i=[],a=[],o=0;for(let e=0;e<n;e++){let t=e/(n-1),s=this._gaussianWeight(t*2-1);i[e]=e-r,a[e]=s,o+=s}for(let e=0;e<a.length;e++)a[e]/=o;let s=[],c=[],l=[];for(let e=0;e<=r;e+=2){let t=Math.min(e+1,Math.floor(r));if(e===t)l.push({o:i[e],w:a[e]});else{let n=t===r,o=a[e]+a[t]*(n?.5:1),s=i[e]+1/(1+a[e]/a[t]);s===0?(l.push({o:i[e],w:a[e]}),l.push({o:i[e+1],w:a[e+1]})):(l.push({o:s,w:o}),l.push({o:-s,w:o}))}}for(let e=0;e<l.length;e++)c[e]=l[e].o,s[e]=l[e].w;i=c,a=s;let u=this.options.engine.getCaps().maxVaryingVectors-+(this.options.shaderLanguage===1),d=Math.max(u,0)-1,f=Math.min(i.length,d),p=``;p+=this._staticDefines,this._staticDefines.indexOf(`DOF`)!=-1&&(p+=`#define CENTER_WEIGHT ${this._glslFloat(a[f-1])}\n`,f--);for(let e=0;e<f;e++)p+=`#define KERNEL_OFFSET${e} ${this._glslFloat(i[e])}\n`,p+=`#define KERNEL_WEIGHT${e} ${this._glslFloat(a[e])}\n`;let m=0;for(let e=d;e<i.length;e++)p+=`#define KERNEL_DEP_OFFSET${m} ${this._glslFloat(i[e])}\n`,p+=`#define KERNEL_DEP_WEIGHT${m} ${this._glslFloat(a[e])}\n`,m++;this.packedFloat&&(p+=`#define PACKEDFLOAT 1`),this.options.blockCompilation=!1,this.updateEffect(p,null,null,{varyingCount:f,depCount:m},e,t)}_nearestBestKernel(e){let t=Math.round(e);for(let e of[t,t-1,t+1,t-2,t+2])if(e%2!=0&&Math.floor(e/2)%2==0&&e>0)return Math.max(e,3);return Math.max(t,3)}_gaussianWeight(e){let t=1/3,n=Math.sqrt(2*Math.PI)*t,r=-(e*e/(2*t*t));return 1/n*Math.exp(r)}_glslFloat(e,t=8){return e.toFixed(t).replace(/0+$/,``)}};H.VertexUrl=`kernelBlur`,H.FragmentUrl=`kernelBlur`,H.Uniforms=[`delta`,`direction`],H.Samplers=[`circleOfConfusionSampler`];var U=class e extends M{get direction(){return this._effectWrapper.direction}set direction(e){this._effectWrapper.direction=e}set kernel(e){this._effectWrapper.kernel=e}get kernel(){return this._effectWrapper.kernel}set packedFloat(e){this._effectWrapper.packedFloat=e}get packedFloat(){return this._effectWrapper.packedFloat}getClassName(){return`BlurPostProcess`}constructor(e,t,n,r,i=null,a=T.BILINEAR_SAMPLINGMODE,o,s,c=0,l=``,u=!1,d=5){let f=typeof r==`number`?u:!!r.blockCompilation,p={uniforms:H.Uniforms,samplers:H.Samplers,size:typeof r==`number`?r:void 0,camera:i,samplingMode:a,engine:o,reusable:s,textureType:c,vertexUrl:H.VertexUrl,indexParameters:{varyingCount:0,depCount:0},textureFormat:d,defines:l,...r,blockCompilation:!0};super(e,H.FragmentUrl,{effectWrapper:typeof r==`number`||!r.effectWrapper?new H(e,o,void 0,void 0,p):void 0,...p}),this._effectWrapper.options.blockCompilation=f,this.direction=t,this.onApplyObservable.add(()=>{this._effectWrapper.textureWidth=this._outputTexture?this._outputTexture.width:this.width,this._effectWrapper.textureHeight=this._outputTexture?this._outputTexture.height:this.height}),this.kernel=n}updateEffect(e=null,t=null,n=null,r,i,a){this._effectWrapper._updateParameters(i,a)}static _Parse(t,n,r,i){return l.Parse(()=>new e(t.name,t.direction,t.kernel,t.options,n,t.renderTargetSamplingMode,r.getEngine(),t.reusable,t.textureType,void 0,!1),t,r,i)}};b([te()],U.prototype,`direction`,null),b([x()],U.prototype,`kernel`,null),b([x()],U.prototype,`packedFloat`,null);var ke=class{constructor(e){this.name=k.NAME_SHADOWGENERATOR,this.scene=e}register(){this.scene._gatherRenderTargetsStage.registerStep(k.STEP_GATHERRENDERTARGETS_SHADOWGENERATOR,this,this._gatherRenderTargets)}rebuild(){}serialize(e){e.shadowGenerators=[];let t=this.scene.lights;for(let n of t){if(n.doNotSerialize)continue;let t=n.getShadowGenerators();if(t){let n=t.values();for(let t=n.next();t.done!==!0;t=n.next()){let n=t.value;n.doNotSerialize||e.shadowGenerators.push(n.serialize())}}}}addFromContainer(e){}removeFromContainer(e,t){}dispose(){}_gatherRenderTargets(e){let t=this.scene;if(this.scene.shadowsEnabled)for(let n=0;n<t.lights.length;n++){let r=t.lights[n],i=r.getShadowGenerators();if(r.isEnabled()&&r.shadowEnabled&&i){let n=i.values();for(let r=n.next();r.done!==!0;r=n.next()){let n=r.value.getShadowMap();t.textures.indexOf(n)!==-1&&e.push(n)}}}}},W=!1;function Ae(e){W||(W=!0,h(k.NAME_SHADOWGENERATOR,(t,n)=>{if(t.shadowGenerators!==void 0&&t.shadowGenerators!==null)for(let r=0,i=t.shadowGenerators.length;r<i;r++){let i=t.shadowGenerators[r];e._CascadedShadowGeneratorParser&&i.className===`CascadedShadowGenerator`?e._CascadedShadowGeneratorParser(i,n):e.Parse(i,n)}}),e._SceneComponentInitialization=e=>{let t=e._getComponent(k.NAME_SHADOWGENERATOR);t||(t=new ke(e),e._addComponent(t))})}var G=class a{get bias(){return this._bias}set bias(e){this._bias=e}get normalBias(){return this._normalBias}set normalBias(e){this._normalBias=e}get blurBoxOffset(){return this._blurBoxOffset}set blurBoxOffset(e){this._blurBoxOffset!==e&&(this._blurBoxOffset=e,this._disposeBlurPostProcesses())}get blurScale(){return this._blurScale}set blurScale(e){this._blurScale!==e&&(this._blurScale=e,this._disposeBlurPostProcesses())}get blurKernel(){return this._blurKernel}set blurKernel(e){this._blurKernel!==e&&(this._blurKernel=e,this._disposeBlurPostProcesses())}get useKernelBlur(){return this._useKernelBlur}set useKernelBlur(e){this._useKernelBlur!==e&&(this._useKernelBlur=e,this._disposeBlurPostProcesses())}get depthScale(){return this._depthScale===void 0?this._light.getDepthScale():this._depthScale}set depthScale(e){this._depthScale=e}_validateFilter(e){return e}get filter(){return this._filter}set filter(e){if(e=this._validateFilter(e),this._light.needCube()){if(e===a.FILTER_BLUREXPONENTIALSHADOWMAP){this.useExponentialShadowMap=!0;return}else if(e===a.FILTER_BLURCLOSEEXPONENTIALSHADOWMAP){this.useCloseExponentialShadowMap=!0;return}else if(e===a.FILTER_PCF||e===a.FILTER_PCSS){this.usePoissonSampling=!0;return}}if((e===a.FILTER_PCF||e===a.FILTER_PCSS)&&!this._scene.getEngine()._features.supportShadowSamplers){this.usePoissonSampling=!0;return}this._filter!==e&&(this._filter=e,this._disposeBlurPostProcesses(),this._applyFilterValues(),this._light._markMeshesAsLightDirty())}get usePoissonSampling(){return this.filter===a.FILTER_POISSONSAMPLING}set usePoissonSampling(e){let t=this._validateFilter(a.FILTER_POISSONSAMPLING);!e&&this.filter!==a.FILTER_POISSONSAMPLING||(this.filter=e?t:a.FILTER_NONE)}get useExponentialShadowMap(){return this.filter===a.FILTER_EXPONENTIALSHADOWMAP}set useExponentialShadowMap(e){let t=this._validateFilter(a.FILTER_EXPONENTIALSHADOWMAP);!e&&this.filter!==a.FILTER_EXPONENTIALSHADOWMAP||(this.filter=e?t:a.FILTER_NONE)}get useBlurExponentialShadowMap(){return this.filter===a.FILTER_BLUREXPONENTIALSHADOWMAP}set useBlurExponentialShadowMap(e){let t=this._validateFilter(a.FILTER_BLUREXPONENTIALSHADOWMAP);!e&&this.filter!==a.FILTER_BLUREXPONENTIALSHADOWMAP||(this.filter=e?t:a.FILTER_NONE)}get useCloseExponentialShadowMap(){return this.filter===a.FILTER_CLOSEEXPONENTIALSHADOWMAP}set useCloseExponentialShadowMap(e){let t=this._validateFilter(a.FILTER_CLOSEEXPONENTIALSHADOWMAP);!e&&this.filter!==a.FILTER_CLOSEEXPONENTIALSHADOWMAP||(this.filter=e?t:a.FILTER_NONE)}get useBlurCloseExponentialShadowMap(){return this.filter===a.FILTER_BLURCLOSEEXPONENTIALSHADOWMAP}set useBlurCloseExponentialShadowMap(e){let t=this._validateFilter(a.FILTER_BLURCLOSEEXPONENTIALSHADOWMAP);!e&&this.filter!==a.FILTER_BLURCLOSEEXPONENTIALSHADOWMAP||(this.filter=e?t:a.FILTER_NONE)}get usePercentageCloserFiltering(){return this.filter===a.FILTER_PCF}set usePercentageCloserFiltering(e){let t=this._validateFilter(a.FILTER_PCF);!e&&this.filter!==a.FILTER_PCF||(this.filter=e?t:a.FILTER_NONE)}get filteringQuality(){return this._filteringQuality}set filteringQuality(e){this._filteringQuality!==e&&(this._filteringQuality=e,this._disposeBlurPostProcesses(),this._applyFilterValues(),this._light._markMeshesAsLightDirty())}get useContactHardeningShadow(){return this.filter===a.FILTER_PCSS}set useContactHardeningShadow(e){let t=this._validateFilter(a.FILTER_PCSS);!e&&this.filter!==a.FILTER_PCSS||(this.filter=e?t:a.FILTER_NONE)}get contactHardeningLightSizeUVRatio(){return this._contactHardeningLightSizeUVRatio}set contactHardeningLightSizeUVRatio(e){this._contactHardeningLightSizeUVRatio=e}get darkness(){return this._darkness}set darkness(e){this.setDarkness(e)}getDarkness(){return this._darkness}setDarkness(e){return e>=1?this._darkness=1:e<=0?this._darkness=0:this._darkness=e,this}get transparencyShadow(){return this._transparencyShadow}set transparencyShadow(e){this.setTransparencyShadow(e)}setTransparencyShadow(e){return this._transparencyShadow=e,this}getShadowMap(){return this._shadowMap}getShadowMapForRendering(){return this._shadowMap2?this._shadowMap2:this._shadowMap}getClassName(){return a.CLASSNAME}addShadowCaster(e,t=!0){if(!this._shadowMap)return this;if(this._shadowMap.renderList||(this._shadowMap.renderList=[]),this._shadowMap.renderList.indexOf(e)===-1&&this._shadowMap.renderList.push(e),t)for(let t of e.getChildMeshes())this._shadowMap.renderList.indexOf(t)===-1&&this._shadowMap.renderList.push(t);return this}removeShadowCaster(e,t=!0){if(!this._shadowMap||!this._shadowMap.renderList)return this;let n=this._shadowMap.renderList.indexOf(e);if(n!==-1&&this._shadowMap.renderList.splice(n,1),t)for(let t of e.getChildren())this.removeShadowCaster(t);return this}getLight(){return this._light}get shaderLanguage(){return this._shaderLanguage}_getCamera(){return this._camera??this._scene.activeCamera}get mapSize(){return this._mapSize}set mapSize(e){this._mapSize=e,this._light._markMeshesAsLightDirty(),this.recreateShadowMap()}get light(){return this._light}set light(e){this._light!==e&&(this.dispose(!1),this._light=e,this._createInstance())}get useFloat32TextureType(){return this._usefullFloatFirst}set useFloat32TextureType(e){this._usefullFloatFirst!==e&&(this.dispose(!1),this._usefullFloatFirst=e,this._createInstance())}get camera(){return this._camera}set camera(e){this._camera!==e&&(this.dispose(!1),this._camera=e,this._createInstance())}get useRedTextureFormat(){return this._useRedTextureType}set useRedTextureFormat(e){this._useRedTextureType!==e&&(this.dispose(!1),this._useRedTextureType=e,this._createInstance())}constructor(e,t,i,o,c,l=!1){this.onBeforeShadowMapRenderObservable=new s,this.onAfterShadowMapRenderObservable=new s,this.onBeforeShadowMapRenderMeshObservable=new s,this.onAfterShadowMapRenderMeshObservable=new s,this.doNotSerialize=!1,this._bias=5e-5,this._normalBias=0,this._blurBoxOffset=1,this._blurScale=2,this._blurKernel=1,this._useKernelBlur=!1,this._filter=a.FILTER_NONE,this._filteringQuality=a.QUALITY_HIGH,this._contactHardeningLightSizeUVRatio=.1,this._darkness=0,this._transparencyShadow=!1,this.enableSoftTransparentShadow=!1,this.useOpacityTextureForTransparentShadow=!1,this.frustumEdgeFalloff=0,this._shaderLanguage=0,this.forceBackFacesOnly=!1,this._lightDirection=n.Zero(),this._viewMatrix=r.Zero(),this._projectionMatrix=r.Zero(),this._transformMatrix=r.Zero(),this._cachedPosition=new n(Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE),this._cachedDirection=new n(Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE),this._currentFaceIndex=0,this._currentFaceIndexCache=0,this._defaultTextureMatrix=r.Identity(),this._shadersLoaded=!1,this._mapSize=e,this._light=t,this._usefullFloatFirst=!!i,this._scene=t.getScene(),this._camera=o??null,this._useRedTextureType=!!c,this._forceGLSL=l,this._createInstance()}_createInstance(){this._initShaderSourceAsync(this._forceGLSL);let e=this._light._shadowGenerators;e||=this._light._shadowGenerators=new Map,e.set(this._camera,this),this.id=this._light.id,this._useUBO=this._scene.getEngine().supportsUniformBuffers,this._useUBO&&(this._sceneUBOs=[this._scene.createSceneUniformBuffer(`Scene for Shadow Generator (light "${this._light.name}")`,{forceMono:!0})]),Ae(a),a._SceneComponentInitialization(this._scene);let t=this._scene.getEngine().getCaps();this._usefullFloatFirst?t.textureFloatRender&&t.textureFloatLinearFiltering?this._textureType=1:t.textureHalfFloatRender&&t.textureHalfFloatLinearFiltering?this._textureType=2:this._textureType=0:t.textureHalfFloatRender&&t.textureHalfFloatLinearFiltering?this._textureType=2:t.textureFloatRender&&t.textureFloatLinearFiltering?this._textureType=1:this._textureType=0,this._initializeGenerator(),this._applyFilterValues()}_initializeGenerator(){this._light._markMeshesAsLightDirty(),this._initializeShadowMap()}_createTargetRenderTexture(){let e=this._scene.getEngine();this._shadowMap?.dispose(),e._features.supportDepthStencilTexture?(this._shadowMap=new j(this._light.name+`_shadowMap`,this._mapSize,this._scene,!1,!0,this._textureType,this._light.needCube(),void 0,!1,!1,void 0,this._useRedTextureType?6:5),this._shadowMap.createDepthStencilTexture(e.useReverseDepthBuffer?516:513,!0,void 0,void 0,void 0,`DepthStencilForShadowGenerator-${this._light.name}`)):this._shadowMap=new j(this._light.name+`_shadowMap`,this._mapSize,this._scene,!1,!0,this._textureType,this._light.needCube()),this._shadowMap.noPrePassRenderer=!0}_initializeShadowMap(){if(this._createTargetRenderTexture(),this._shadowMap===null)return;this._shadowMap.wrapU=T.CLAMP_ADDRESSMODE,this._shadowMap.wrapV=T.CLAMP_ADDRESSMODE,this._shadowMap.anisotropicFilteringLevel=1,this._shadowMap.updateSamplingMode(T.BILINEAR_SAMPLINGMODE),this._shadowMap.renderParticles=!1,this._shadowMap.ignoreCameraViewport=!0,this._storedUniqueId&&(this._shadowMap.uniqueId=this._storedUniqueId),this._shadowMap.customRenderFunction=(e,t,n,r)=>this._renderForShadowMap(e,t,n,r),this._shadowMap.customIsReadyFunction=(e,t,n)=>{if(!n||!e.subMeshes)return!0;let r=!0;for(let t of e.subMeshes){let e=t.getRenderingMesh(),n=this._scene.getEngine(),i=t.getMaterial();if(!i||t.verticesCount===0||this.customAllowRendering&&!this.customAllowRendering(t))continue;let a=e._getInstancesRenderList(t._id,!!t.getReplacementMesh());if(a.mustReturn)continue;let o=n.getCaps().instancedArrays&&(a.visibleInstances[t._id]!==null&&a.visibleInstances[t._id]!==void 0||e.hasThinInstances),s=i.needAlphaBlendingForMesh(e);r=this.isReady(t,o,s)&&r}return r};let e=this._scene.getEngine();this._shadowMap.onBeforeBindObservable.add(()=>{this._currentSceneUBO=this._scene.getSceneUniformBuffer(),e._enableGPUDebugMarkers&&e._debugPushGroup?.(`Shadow map generation for pass id ${e.currentRenderPassId}`)}),this._shadowMap.onBeforeRenderObservable.add(t=>{this._sceneUBOs&&this._scene.setSceneUniformBuffer(this._sceneUBOs[0]),this._currentFaceIndex=t,this._filter===a.FILTER_PCF&&e.setColorWrite(!1),this.getTransformMatrix(),O.eyeAtCamera=!1,this._scene.setTransformMatrix(this._viewMatrix,this._projectionMatrix),this._sceneUBOs&&(this._scene.getSceneUniformBuffer().unbindEffect(),this._scene.finalizeSceneUbo())}),this._shadowMap.onAfterUnbindObservable.add(()=>{if(this._sceneUBOs&&this._scene.setSceneUniformBuffer(this._currentSceneUBO),O.eyeAtCamera=!0,this._scene.updateTransformMatrix(),this._filter===a.FILTER_PCF&&e.setColorWrite(!0),!this.useBlurExponentialShadowMap&&!this.useBlurCloseExponentialShadowMap){e._debugPopGroup?.();return}let t=this.getShadowMapForRendering();t&&(this._scene.postProcessManager.directRender(this._blurPostProcesses,t.renderTarget,!0),e.unBindFramebuffer(t.renderTarget,!0)),e._enableGPUDebugMarkers&&e._debugPopGroup?.()});let t=new i(0,0,0,0),n=new i(1,1,1,1);this._shadowMap.onClearObservable.add(e=>{this._filter===a.FILTER_PCF?e.clear(n,!1,!0,!1):this.useExponentialShadowMap||this.useBlurExponentialShadowMap?e.clear(t,!0,!0,!1):e.clear(n,!0,!0,!1)}),this._shadowMap.onResizeObservable.add(e=>{this._storedUniqueId=this._shadowMap.uniqueId,this._mapSize=e.getRenderSize(),this._light._markMeshesAsLightDirty(),this.recreateShadowMap()});for(let e=S.MIN_RENDERINGGROUPS;e<S.MAX_RENDERINGGROUPS;e++)this._shadowMap.setRenderingAutoClearDepthStencil(e,!1)}async _initShaderSourceAsync(e=!1){this._scene.getEngine().isWebGPU&&!e&&!a.ForceGLSL?(this._shaderLanguage=1,await Promise.all([w(()=>import(`./shadowMap.fragment-DUFTmQJ_.js`),__vite__mapDeps([9,1,10,3])),w(()=>import(`./shadowMap.vertex-CCycMdLk.js`),__vite__mapDeps([11,1,12,13,14,15,16])),w(()=>import(`./depthBoxBlur.fragment-D2KJPEQv.js`),__vite__mapDeps([17,1])),w(()=>import(`./shadowMapFragmentSoftTransparentShadow-B6k0i9Au.js`),__vite__mapDeps([18,1]))])):await Promise.all([w(()=>import(`./shadowMap.fragment-DX4Yo1bp.js`),__vite__mapDeps([19,1,20,7])),w(()=>import(`./shadowMap.vertex-CMpfNXd4.js`),__vite__mapDeps([21,1,22,23,24,25,26,27])),w(()=>import(`./depthBoxBlur.fragment-CLEAG5DG.js`),__vite__mapDeps([28,1])),w(()=>import(`./shadowMapFragmentSoftTransparentShadow-R_iOKnyx.js`),__vite__mapDeps([29,1]))]),this._shadersLoaded=!0}_initializeBlurRTTAndPostProcesses(){let t=this._scene.getEngine(),n=this._mapSize/this.blurScale;(!this.useKernelBlur||this.blurScale!==1)&&(this._shadowMap2=new j(this._light.name+`_shadowMap2`,n,this._scene,!1,!0,this._textureType,void 0,void 0,!1),this._shadowMap2.wrapU=T.CLAMP_ADDRESSMODE,this._shadowMap2.wrapV=T.CLAMP_ADDRESSMODE,this._shadowMap2.updateSamplingMode(T.BILINEAR_SAMPLINGMODE)),this.useKernelBlur?(this._kernelBlurXPostprocess=new U(this._light.name+`KernelBlurX`,new e(1,0),this.blurKernel,1,null,T.BILINEAR_SAMPLINGMODE,t,!1,this._textureType),this._kernelBlurXPostprocess.width=n,this._kernelBlurXPostprocess.height=n,this._kernelBlurXPostprocess.externalTextureSamplerBinding=!0,this._kernelBlurXPostprocess.onApplyObservable.add(e=>{e.setTexture(`textureSampler`,this._shadowMap)}),this._kernelBlurYPostprocess=new U(this._light.name+`KernelBlurY`,new e(0,1),this.blurKernel,1,null,T.BILINEAR_SAMPLINGMODE,t,!1,this._textureType),this._kernelBlurXPostprocess.autoClear=!1,this._kernelBlurYPostprocess.autoClear=!1,this._textureType===0&&(this._kernelBlurXPostprocess.packedFloat=!0,this._kernelBlurYPostprocess.packedFloat=!0),this._blurPostProcesses=[this._kernelBlurXPostprocess,this._kernelBlurYPostprocess]):(this._boxBlurPostprocess=new M(this._light.name+`DepthBoxBlur`,`depthBoxBlur`,[`screenSize`,`boxOffset`],[],1,null,T.BILINEAR_SAMPLINGMODE,t,!1,`#define OFFSET `+this._blurBoxOffset,this._textureType,void 0,void 0,void 0,void 0,this._shaderLanguage),this._boxBlurPostprocess.externalTextureSamplerBinding=!0,this._boxBlurPostprocess.onApplyObservable.add(e=>{e.setFloat2(`screenSize`,n,n),e.setTexture(`textureSampler`,this._shadowMap)}),this._boxBlurPostprocess.autoClear=!1,this._blurPostProcesses=[this._boxBlurPostprocess])}_renderForShadowMap(e,t,n,r){let i;if(r.length)for(i=0;i<r.length;i++)this._renderSubMeshForShadowMap(r.data[i]);for(i=0;i<e.length;i++)this._renderSubMeshForShadowMap(e.data[i]);for(i=0;i<t.length;i++)this._renderSubMeshForShadowMap(t.data[i]);if(this._transparencyShadow)for(i=0;i<n.length;i++)this._renderSubMeshForShadowMap(n.data[i],!0);else for(i=0;i<n.length;i++)n.data[i].getEffectiveMesh()._internalAbstractMeshDataInfo._isActiveIntermediate=!1}_bindCustomEffectForRenderSubMeshForShadowMap(e,t,n){t.setMatrix(`viewProjection`,this.getTransformMatrix())}_renderSubMeshForShadowMap(e,n=!1){let r=e.getRenderingMesh(),i=e.getEffectiveMesh(),a=this._scene,o=a.getEngine(),s=e.getMaterial();if(i._internalAbstractMeshDataInfo._isActiveIntermediate=!1,!s||e.verticesCount===0||e._renderId===a.getRenderId())return;let c=a.useRightHandedSystem,l=i._getWorldMatrixDeterminant()<0,u=s._getEffectiveOrientation(r);(l&&!c||!l&&c)&&(u=+(u===0));let d=u===0;o.setState(s.backFaceCulling,void 0,void 0,d,s.cullBackFaces);let f=r._getInstancesRenderList(e._id,!!e.getReplacementMesh());if(f.mustReturn)return;let p=o.getCaps().instancedArrays&&(f.visibleInstances[e._id]!==null&&f.visibleInstances[e._id]!==void 0||r.hasThinInstances);if(!(this.customAllowRendering&&!this.customAllowRendering(e)))if(this.isReady(e,p,n)){e._renderId=a.getRenderId();let c=s.shadowDepthWrapper,l=c?.getEffect(e,this,o.currentRenderPassId)??e._getDrawWrapper(),u=fe.GetEffect(l);o.enableEffect(l),p||r._bind(e,u,s.fillMode),this.getTransformMatrix(),u.setFloat3(`biasAndScaleSM`,this.bias,this.normalBias,this.depthScale),this.getLight().getTypeID()===D.LIGHTTYPEID_DIRECTIONALLIGHT?u.setVector3(`lightDataSM`,this._cachedDirection):u.setVector3(`lightDataSM`,this._cachedPosition.subtractToRef(this._scene.floatingOriginOffset,t.Vector3[0]));let d=this._getCamera();if(u.setFloat2(`depthValuesSM`,this.getLight().getDepthMinZ(d),this.getLight().getDepthMinZ(d)+this.getLight().getDepthMaxZ(d)),n&&this.enableSoftTransparentShadow&&u.setFloat2(`softTransparentShadowSM`,i.visibility*s.alpha,+!!this._opacityTexture?.getAlphaFromRGB),c)e._setMainDrawWrapperOverride(l),c.standalone?c.baseMaterial.bindForSubMesh(i.getWorldMatrix(),r,e):s.bindForSubMesh(i.getWorldMatrix(),r,e),e._setMainDrawWrapperOverride(null);else{this._opacityTexture&&(u.setTexture(`diffuseSampler`,this._opacityTexture),u.setMatrix(`diffuseMatrix`,this._opacityTexture.getTextureMatrix()||this._defaultTextureMatrix)),le(r,u),ce(r,u),r.morphTargetManager&&r.morphTargetManager.isUsingTextureForTargets&&r.morphTargetManager._bind(u);let t=e.getMesh().bakedVertexAnimationManager;t&&t.isEnabled&&t.bind(u,p),ae(u,s,a)}!this._useUBO&&!c&&this._bindCustomEffectForRenderSubMeshForShadowMap(e,u,i),de(u,this._scene.getSceneUniformBuffer()),this._scene.getSceneUniformBuffer().bindUniformBuffer();let m=i.getWorldMatrix();p&&(i.getMeshUniformBuffer().bindToEffect(u,`Mesh`),i.transferToEffect(m)),this.forceBackFacesOnly&&o.setState(!0,0,!1,!0,s.cullBackFaces),this.onBeforeShadowMapRenderMeshObservable.notifyObservers(r),this.onBeforeShadowMapRenderObservable.notifyObservers(u),r._processRendering(i,e,u,s.fillMode,f,p,(e,t)=>{i!==r&&!e?(r.getMeshUniformBuffer().bindToEffect(u,`Mesh`),r.transferToEffect(t)):(i.getMeshUniformBuffer().bindToEffect(u,`Mesh`),i.transferToEffect(e?t:m))}),this.forceBackFacesOnly&&o.setState(!0,0,!1,!1,s.cullBackFaces),this.onAfterShadowMapRenderObservable.notifyObservers(u),this.onAfterShadowMapRenderMeshObservable.notifyObservers(r)}else this._shadowMap&&this._shadowMap.resetRefreshCounter()}_applyFilterValues(){this._shadowMap&&(this.filter===a.FILTER_NONE||this.filter===a.FILTER_PCSS?this._shadowMap.updateSamplingMode(T.NEAREST_SAMPLINGMODE):this._shadowMap.updateSamplingMode(T.BILINEAR_SAMPLINGMODE))}forceCompilation(e,t){let n={useInstances:!1,...t},r=this.getShadowMap();if(!r){e&&e(this);return}let i=r.renderList;if(!i){e&&e(this);return}let a=[];for(let e of i)a.push(...e.subMeshes);if(a.length===0){e&&e(this);return}let o=0,s=()=>{if(!(!this._scene||!this._scene.getEngine())){for(;this.isReady(a[o],n.useInstances,a[o].getMaterial()?.needAlphaBlendingForMesh(a[o].getMesh())??!1);)if(o++,o>=a.length){e&&e(this);return}setTimeout(s,16)}};s()}async forceCompilationAsync(e){return await new Promise(t=>{this.forceCompilation(()=>{t()},e)})}_isReadyCustomDefines(e,t,n){}_prepareShadowDefines(e,t,n,r){n.push(`#define SM_LIGHTTYPE_`+this._light.getClassName().toUpperCase()),n.push(`#define SM_FLOAT `+(this._textureType===0?`0`:`1`)),n.push(`#define SM_ESM `+(this.useExponentialShadowMap||this.useBlurExponentialShadowMap?`1`:`0`)),n.push(`#define SM_DEPTHTEXTURE `+(this.usePercentageCloserFiltering||this.useContactHardeningShadow?`1`:`0`));let i=e.getMesh();return n.push(`#define SM_NORMALBIAS `+(this.normalBias&&i.isVerticesDataPresent(C.NormalKind)?`1`:`0`)),n.push(`#define SM_DIRECTIONINLIGHTDATA `+(this.getLight().getTypeID()===D.LIGHTTYPEID_DIRECTIONALLIGHT?`1`:`0`)),n.push(`#define SM_USEDISTANCE `+(this._light.needCube()?`1`:`0`)),n.push(`#define SM_SOFTTRANSPARENTSHADOW `+(this.enableSoftTransparentShadow&&r?`1`:`0`)),this._isReadyCustomDefines(n,e,t),n}isReady(e,t,n){if(!this._shadersLoaded)return!1;let r=e.getMaterial(),i=r?.shadowDepthWrapper;if(this._opacityTexture=null,!r)return!1;let o=[];if(this._prepareShadowDefines(e,t,o,n),i){if(!i.isReadyForSubMesh(e,o,this,t,this._scene.getEngine().currentRenderPassId))return!1}else{let n=e._getDrawWrapper(void 0,!0),i=n.effect,s=n.defines,c=[C.PositionKind],l=e.getMesh(),u=!1,d=!1,f=!1;this.normalBias&&l.isVerticesDataPresent(C.NormalKind)&&(c.push(C.NormalKind),o.push(`#define NORMAL`),u=!0,l.nonUniformScaling&&o.push(`#define NONUNIFORMSCALING`));let p=r.needAlphaTestingForMesh(l);if((p||r.needAlphaBlendingForMesh(l))&&(this.useOpacityTextureForTransparentShadow?this._opacityTexture=r.opacityTexture:this._opacityTexture=r.getAlphaTestTexture(),this._opacityTexture)){if(!this._opacityTexture.isReady())return!1;let e=r.alphaCutOff??a.DEFAULT_ALPHA_CUTOFF;o.push(`#define ALPHATEXTURE`),p&&o.push(`#define ALPHATESTVALUE ${e}${e%1==0?`.`:``}`),l.isVerticesDataPresent(C.UVKind)&&(c.push(C.UVKind),o.push(`#define UV1`),d=!0),l.isVerticesDataPresent(C.UV2Kind)&&this._opacityTexture.coordinatesIndex===1&&(c.push(C.UV2Kind),o.push(`#define UV2`),f=!0)}let m=new me;if(l.useBones&&l.computeBonesUsingShaders&&l.skeleton){c.push(C.MatricesIndicesKind),c.push(C.MatricesWeightsKind),l.numBoneInfluencers>4&&(c.push(C.MatricesIndicesExtraKind),c.push(C.MatricesWeightsExtraKind));let e=l.skeleton;o.push(`#define NUM_BONE_INFLUENCERS `+l.numBoneInfluencers),l.numBoneInfluencers>0&&m.addCPUSkinningFallback(0,l),e.isUsingTextureForMatrices?o.push(`#define BONETEXTURE`):o.push(`#define BonesPerMesh `+(e.bones.length+1))}else o.push(`#define NUM_BONE_INFLUENCERS 0`);let h=l.morphTargetManager?se(l.morphTargetManager,o,c,l,!0,u,!1,d,f,!1):0;if(oe(r,this._scene,o),t&&(o.push(`#define INSTANCES`),re(c),e.getRenderingMesh().hasThinInstances&&o.push(`#define THIN_INSTANCES`)),this.customShaderOptions&&this.customShaderOptions.defines)for(let e of this.customShaderOptions.defines)o.indexOf(e)===-1&&o.push(e);let g=l.bakedVertexAnimationManager;g&&g.isEnabled&&(o.push(`#define BAKED_VERTEX_ANIMATION_TEXTURE`),t&&c.push(`bakedVertexAnimationSettingsInstanced`));let _=o.join(`
`);if(s!==_){s=_;let e=`shadowMap`,t=[`world`,`mBones`,`viewProjection`,`diffuseMatrix`,`lightDataSM`,`depthValuesSM`,`biasAndScaleSM`,`morphTargetInfluences`,`morphTargetCount`,`boneTextureInfo`,`softTransparentShadowSM`,`morphTargetTextureInfo`,`morphTargetTextureIndices`,`bakedVertexAnimationSettings`,`bakedVertexAnimationTextureSizeInverted`,`bakedVertexAnimationTime`,`bakedVertexAnimationTexture`],r=[`diffuseSampler`,`boneSampler`,`morphTargets`,`bakedVertexAnimationTexture`],a=[`Scene`,`Mesh`];if(ie(t),this.customShaderOptions){if(e=this.customShaderOptions.shaderName,this.customShaderOptions.attributes)for(let e of this.customShaderOptions.attributes)c.indexOf(e)===-1&&c.push(e);if(this.customShaderOptions.uniforms)for(let e of this.customShaderOptions.uniforms)t.indexOf(e)===-1&&t.push(e);if(this.customShaderOptions.samplers)for(let e of this.customShaderOptions.samplers)r.indexOf(e)===-1&&r.push(e)}let o=this._scene.getEngine();i=o.createEffect(e,{attributes:c,uniformsNames:t,uniformBuffersNames:a,samplers:r,defines:_,fallbacks:m,onCompiled:null,onError:null,indexParameters:{maxSimultaneousMorphTargets:h},shaderLanguage:this._shaderLanguage},o),n.setEffect(i,s)}if(!i.isReady())return!1}return(this.useBlurExponentialShadowMap||this.useBlurCloseExponentialShadowMap)&&(!this._blurPostProcesses||!this._blurPostProcesses.length)&&this._initializeBlurRTTAndPostProcesses(),!(this._kernelBlurXPostprocess&&!this._kernelBlurXPostprocess.isReady()||this._kernelBlurYPostprocess&&!this._kernelBlurYPostprocess.isReady()||this._boxBlurPostprocess&&!this._boxBlurPostprocess.isReady())}prepareDefines(e,t){let n=this._scene,r=this._light;!n.shadowsEnabled||!r.shadowEnabled||(e[`SHADOW`+t]=!0,this.useContactHardeningShadow?(e[`SHADOWPCSS`+t]=!0,this._filteringQuality===a.QUALITY_LOW?e[`SHADOWLOWQUALITY`+t]=!0:this._filteringQuality===a.QUALITY_MEDIUM&&(e[`SHADOWMEDIUMQUALITY`+t]=!0)):this.usePercentageCloserFiltering?(e[`SHADOWPCF`+t]=!0,this._filteringQuality===a.QUALITY_LOW?e[`SHADOWLOWQUALITY`+t]=!0:this._filteringQuality===a.QUALITY_MEDIUM&&(e[`SHADOWMEDIUMQUALITY`+t]=!0)):this.usePoissonSampling?e[`SHADOWPOISSON`+t]=!0:this.useExponentialShadowMap||this.useBlurExponentialShadowMap?e[`SHADOWESM`+t]=!0:(this.useCloseExponentialShadowMap||this.useBlurCloseExponentialShadowMap)&&(e[`SHADOWCLOSEESM`+t]=!0),r.needCube()&&(e[`SHADOWCUBE`+t]=!0))}bindShadowLight(e,n){let r=this._light,i=this._scene;if(!i.shadowsEnabled||!r.shadowEnabled)return;let o=this._getCamera(),s=this.getShadowMap();if(!s)return;if(!r.needCube()){let r=i.floatingOriginOffset,a=this.getTransformMatrix(),o=i.floatingOriginMode?pe(r,this._viewMatrix,this._projectionMatrix,t.Matrix[0]):a;n.setMatrix(`lightMatrix`+e,o)}let c=this.getShadowMapForRendering();this._filter===a.FILTER_PCF?(n.setDepthStencilTexture(`shadowTexture`+e,c),r._uniformBuffer.updateFloat4(`shadowsInfo`,this.getDarkness(),s.getSize().width,1/s.getSize().width,this.frustumEdgeFalloff,e)):this._filter===a.FILTER_PCSS?(n.setDepthStencilTexture(`shadowTexture`+e,c),n.setTexture(`depthTexture`+e,c),r._uniformBuffer.updateFloat4(`shadowsInfo`,this.getDarkness(),1/s.getSize().width,this._contactHardeningLightSizeUVRatio*s.getSize().width,this.frustumEdgeFalloff,e)):(n.setTexture(`shadowTexture`+e,c),r._uniformBuffer.updateFloat4(`shadowsInfo`,this.getDarkness(),this.blurScale/s.getSize().width,this.depthScale,this.frustumEdgeFalloff,e)),r._uniformBuffer.updateFloat2(`depthValues`,this.getLight().getDepthMinZ(o),this.getLight().getDepthMinZ(o)+this.getLight().getDepthMaxZ(o),e)}get viewMatrix(){return this._viewMatrix}get projectionMatrix(){return this._projectionMatrix}getTransformMatrix(){let e=this._scene;if(this._currentRenderId===e.getRenderId()&&this._currentFaceIndexCache===this._currentFaceIndex)return this._transformMatrix;this._currentRenderId=e.getRenderId(),this._currentFaceIndexCache=this._currentFaceIndex;let t=this._light.position;if(this._light.computeTransformedInformation()&&(t=this._light.transformedPosition),n.NormalizeToRef(this._light.getShadowDirection(this._currentFaceIndex),this._lightDirection),Math.abs(n.Dot(this._lightDirection,n.Up()))===1&&(this._lightDirection.z=1e-13),this._light.needProjectionMatrixCompute()||!this._cachedPosition||!this._cachedDirection||!t.equals(this._cachedPosition)||!this._lightDirection.equals(this._cachedDirection)){this._cachedPosition.copyFrom(t),this._cachedDirection.copyFrom(this._lightDirection),r.LookAtLHToRef(t,t.add(this._lightDirection),n.Up(),this._viewMatrix);let e=this.getShadowMap();if(e){let t=e.renderList;t&&this._light.setShadowProjectionMatrix(this._projectionMatrix,this._viewMatrix,t)}this._viewMatrix.multiplyToRef(this._projectionMatrix,this._transformMatrix)}return this._transformMatrix}recreateShadowMap(){let e=this._shadowMap;if(!e)return;let t=e.renderList;if(this._disposeRTTandPostProcesses(),this._initializeGenerator(),this.filter=this._filter,this._applyFilterValues(),t){this._shadowMap.renderList||(this._shadowMap.renderList=[]);for(let e of t)this._shadowMap.renderList.push(e)}else this._shadowMap.renderList=null}_disposeBlurPostProcesses(){this._shadowMap2&&=(this._shadowMap2.dispose(),null),this._boxBlurPostprocess&&=(this._boxBlurPostprocess.dispose(),null),this._kernelBlurXPostprocess&&=(this._kernelBlurXPostprocess.dispose(),null),this._kernelBlurYPostprocess&&=(this._kernelBlurYPostprocess.dispose(),null),this._blurPostProcesses=[]}_disposeRTTandPostProcesses(){this._shadowMap&&=(this._shadowMap.dispose(),null),this._disposeBlurPostProcesses()}_disposeSceneUBOs(){if(this._sceneUBOs){for(let e of this._sceneUBOs)e.dispose();this._sceneUBOs=[]}}dispose(e=!0){if(this._disposeRTTandPostProcesses(),this._disposeSceneUBOs(),this._light){if(this._light._shadowGenerators){let e=this._light._shadowGenerators.entries();for(let t=e.next();t.done!==!0;t=e.next()){let[e,n]=t.value;n===this&&this._light._shadowGenerators.delete(e)}this._light._shadowGenerators.size===0&&(this._light._shadowGenerators=null)}this._light._markMeshesAsLightDirty()}e&&(this.onBeforeShadowMapRenderMeshObservable.clear(),this.onBeforeShadowMapRenderObservable.clear(),this.onAfterShadowMapRenderMeshObservable.clear(),this.onAfterShadowMapRenderObservable.clear())}serialize(){let e={},t=this.getShadowMap();if(!t)return e;if(e.className=this.getClassName(),e.lightId=this._light.id,e.cameraId=this._camera?.id,e.id=this.id,e.mapSize=t.getRenderSize(),e.forceBackFacesOnly=this.forceBackFacesOnly,e.darkness=this.getDarkness(),e.transparencyShadow=this._transparencyShadow,e.frustumEdgeFalloff=this.frustumEdgeFalloff,e.bias=this.bias,e.normalBias=this.normalBias,e.usePercentageCloserFiltering=this.usePercentageCloserFiltering,e.useContactHardeningShadow=this.useContactHardeningShadow,e.contactHardeningLightSizeUVRatio=this.contactHardeningLightSizeUVRatio,e.filteringQuality=this.filteringQuality,e.useExponentialShadowMap=this.useExponentialShadowMap,e.useBlurExponentialShadowMap=this.useBlurExponentialShadowMap,e.useCloseExponentialShadowMap=this.useBlurExponentialShadowMap,e.useBlurCloseExponentialShadowMap=this.useBlurExponentialShadowMap,e.usePoissonSampling=this.usePoissonSampling,e.depthScale=this.depthScale,e.blurBoxOffset=this.blurBoxOffset,e.blurKernel=this.blurKernel,e.blurScale=this.blurScale,e.useKernelBlur=this.useKernelBlur,e.renderList=[],t.renderList)for(let n=0;n<t.renderList.length;n++){let r=t.renderList[n];e.renderList.push(r.id)}return e}static Parse(e,t,n){let r=t.getLightById(e.lightId),i=e.cameraId===void 0?null:t.getCameraById(e.cameraId),o=n?n(e.mapSize,r,i):new a(e.mapSize,r,void 0,i),s=o.getShadowMap();if(e.renderList.length&&s){let n=new Set(e.renderList),r=s.renderList;r||=s.renderList=[];let i=t.meshes;for(let e of i)n.has(e.id)&&r.push(e)}return e.id!==void 0&&(o.id=e.id),o.forceBackFacesOnly=!!e.forceBackFacesOnly,e.darkness!==void 0&&o.setDarkness(e.darkness),e.transparencyShadow&&o.setTransparencyShadow(!0),e.frustumEdgeFalloff!==void 0&&(o.frustumEdgeFalloff=e.frustumEdgeFalloff),e.bias!==void 0&&(o.bias=e.bias),e.normalBias!==void 0&&(o.normalBias=e.normalBias),e.usePercentageCloserFiltering?o.usePercentageCloserFiltering=!0:e.useContactHardeningShadow?o.useContactHardeningShadow=!0:e.usePoissonSampling?o.usePoissonSampling=!0:e.useExponentialShadowMap?o.useExponentialShadowMap=!0:e.useBlurExponentialShadowMap?o.useBlurExponentialShadowMap=!0:e.useCloseExponentialShadowMap?o.useCloseExponentialShadowMap=!0:e.useBlurCloseExponentialShadowMap?o.useBlurCloseExponentialShadowMap=!0:e.useVarianceShadowMap?o.useExponentialShadowMap=!0:e.useBlurVarianceShadowMap&&(o.useBlurExponentialShadowMap=!0),e.contactHardeningLightSizeUVRatio!==void 0&&(o.contactHardeningLightSizeUVRatio=e.contactHardeningLightSizeUVRatio),e.filteringQuality!==void 0&&(o.filteringQuality=e.filteringQuality),e.depthScale&&(o.depthScale=e.depthScale),e.blurScale&&(o.blurScale=e.blurScale),e.blurBoxOffset&&(o.blurBoxOffset=e.blurBoxOffset),e.useKernelBlur&&(o.useKernelBlur=e.useKernelBlur),e.blurKernel&&(o.blurKernel=e.blurKernel),o}};G.CLASSNAME=`ShadowGenerator`,G.ForceGLSL=!1,G.FILTER_NONE=0,G.FILTER_EXPONENTIALSHADOWMAP=1,G.FILTER_POISSONSAMPLING=2,G.FILTER_BLUREXPONENTIALSHADOWMAP=3,G.FILTER_CLOSEEXPONENTIALSHADOWMAP=4,G.FILTER_BLURCLOSEEXPONENTIALSHADOWMAP=5,G.FILTER_PCF=6,G.FILTER_PCSS=7,G.QUALITY_HIGH=0,G.QUALITY_MEDIUM=1,G.QUALITY_LOW=2,G.DEFAULT_ALPHA_CUTOFF=.5,G._SceneComponentInitialization=e=>{throw o(`ShadowGeneratorSceneComponent`)},G._CascadedShadowGeneratorParser=null;var K=[{label:`rough stone`,albedo:new a(.82,.8,.74),metallic:0,roughness:.86},{label:`smooth ceramic`,albedo:new a(.93,.91,.86),metallic:0,roughness:.28},{label:`brushed bronze`,albedo:new a(.86,.57,.33),metallic:.72,roughness:.48},{label:`polished steel`,albedo:new a(.78,.8,.82),metallic:1,roughness:.16}];function je(e){e.scene.clearColor=new i(0,0,0,1),e.scene.ambientColor=a.Black(),e.scene.environmentIntensity=0,e.scene.environmentTexture=null;for(let t of e.scene.lights)t.intensity=0,t.setEnabled(!1);e.bakeLight.intensity=0,e.bakeLight.setEnabled(!1)}function Me(e){for(let t of e)t.renderingGroupId=0,t.receiveShadows=!0}function Ne(e){let t=e.shadowMaskTexture?null:e.detailVolumeTexture;I(e.staticPlugins,e.volumeTexture,e.intensity),L(e.staticPlugins,e.shadowMaskTexture),I(e.dynamicPlugins,e.volumeTexture,e.intensity,t),L(e.dynamicPlugins,null)}function Pe(e,t,r){let i=new n(t.bounds.max[0]-t.bounds.min[0],t.bounds.max[1]-t.bounds.min[1],t.bounds.max[2]-t.bounds.min[2]),a=Y(Math.min(i.x,i.z)*.014,.18,.32);return _.map((t,i)=>{let o=new n(t.x,t.y,t.z),s=i%2==0?u.CreateSphere(`${r}-pbr-object-${t.id}`,{diameter:a*2.2,segments:32},e):u.CreateBox(`${r}-pbr-object-${t.id}`,{size:a*2},e),c=new _e(`${r}-vlm-pbr-material-${t.id}`,e),l=K[i%K.length];return c.albedoColor=l.albedo,c.metallic=l.metallic,c.roughness=l.roughness,c.environmentIntensity=0,c.directIntensity=1,c.backFaceCulling=!1,c.forceDepthWrite=!0,s.renderingGroupId=0,s.receiveShadows=!0,s.material=c,{mesh:s,material:c,center:o,name:t.name,materialLabel:l.label,phase:i*Math.PI*.5,axisDistance:Math.max(1.4,t.range*.36)}})}function Fe(e,t,r,i){let a=[...r,...t],o=[];return{lights:_.filter(e=>e.enabled&&e.intensity>0&&e.range>0).map(r=>{let s=new d(`${i}-dynamic-direct-${r.id}`,new n(r.x,r.y,r.z),e);s.intensityMode=E.INTENSITYMODE_LUMINOUSINTENSITY,s.falloffType=E.FALLOFF_PHYSICAL,s.diffuse=Re(r.color),s.specular=s.diffuse.scale(.55),s.intensity=r.intensity,s.range=r.range,s.radius=Math.max(0,r.sourceRadius),s.includedOnlyMeshes.push(...t);let c=new G(1024,s,!0);c.usePoissonSampling=!0,c.bias=8e-4,c.normalBias=.035,c.setDarkness(.18);for(let e of a)c.addShadowCaster(e);return o.push(c),s}),shadowGenerators:o}}function Ie(e,t,r,i){let a=e.axisDistance*(.18+.82*(.5+.5*Math.sin(t*1.25+e.phase)))*r,o=t*.62+e.phase,s=Math.sin(t*1.8+e.phase)*.28,c=new n(Math.cos(o)*a,s,Math.sin(o)*a);e.mesh.position.copyFrom(J(e.center.add(c),i)),e.mesh.rotation.x=t*.75+e.phase,e.mesh.rotation.y=t*1.25,e.mesh.rotation.z=t*.35}function q(e,t){return t.x>=e.bounds.min[0]&&t.y>=e.bounds.min[1]&&t.z>=e.bounds.min[2]&&t.x<=e.bounds.max[0]&&t.y<=e.bounds.max[1]&&t.z<=e.bounds.max[2]}function J(e,t){return new n(Y(e.x,t.bounds.min[0],t.bounds.max[0]),Y(e.y,t.bounds.min[1],t.bounds.max[1]),Y(e.z,t.bounds.min[2],t.bounds.max[2]))}function Le(e){for(let t of e?.shadowGenerators??[])t.dispose();for(let t of e?.lights??[])t.dispose()}function Re(e){let t=e.trim().replace(/^#/,``),n=t.length===3?t.split(``).map(e=>`${e}${e}`).join(``):t.padEnd(6,`f`).slice(0,6),r=Number.parseInt(n,16);return Number.isFinite(r)?new a((r>>16&255)/255,(r>>8&255)/255,(r&255)/255):a.White()}function Y(e,t,n){return Math.min(n,Math.max(t,e))}var ze=32;function Be(e,t){let r=t.shaderErrors??[],i=null,a=null,o=null;je(e),Me(e.importedMeshes);let s=async(n,r)=>{l();let s=n.baseVolume,c=n.detailVolume,u=P(e.scene,s),d=c?P(e.scene,c):null,f=n.shadowMask&&(t.loadStaticShadowMask??!0)?xe(e.scene,n.shadowMask):null;i??=F(e.importedMeshes);let p=Pe(e.scene,s,t.namePrefix),m=Fe(e.scene,p.map(e=>e.mesh),e.importedMeshes,t.namePrefix),h=F(p.map(e=>e.mesh)),g=[...i,...h];(t.frameCameraOnLoad??!1)&&it(e.camera,p,s),Ne({staticPlugins:i,dynamicPlugins:h,volumeTexture:u,detailVolumeTexture:d,shadowMaskTexture:f,intensity:1});let _=Ze(e.importedMeshes,i.length),v=await Qe([...e.importedMeshes,...p.map(e=>e.mesh)]),y=t.forceStaticCpuPreviewMaterials?$e(e.importedMeshes,s,c??void 0,1):[];return a={volume:s,detailVolume:c,volumeTexture:u,detailVolumeTexture:d,shadowMaskTexture:f,dynamicObjects:p,dynamicLighting:m,dynamicPlugins:h,allPlugins:g,staticCpuPreviewMaterials:y},o={sourceLabel:r,bundle:n,volume:s,detailVolume:c,dynamicObjects:p,staticAudit:_,compileAudit:v,shadowMaskTexture:f,dynamicLightCount:m.lights.length,dynamicPluginCount:h.length,staticPluginCount:i.length,cpuPreviewCount:y.length},o},c=e=>{if(!a)return null;Se(a.allPlugins,e.intensity),tt(a.staticCpuPreviewMaterials,a.volume,a.detailVolume??void 0,e.intensity);let t=performance.now()*.001*e.speed,r=[],i=0,o=1/0,s=0;for(let c of a.dynamicObjects){Ie(c,t,e.distance,a.volume);let l=(a.detailVolume&&q(a.detailVolume,c.mesh.position)?m(a.detailVolume,c.mesh.position):m(a.volume,c.mesh.position)).ambient.scale(e.intensity),u=l.r+l.g+l.b,d=Math.max(l.r,l.g,l.b)-Math.min(l.r,l.g,l.b),f=n.Distance(c.mesh.position,c.center);o=Math.min(o,u),s=Math.max(s,u),i=Math.max(i,d),r.push(`${c.name}/${c.materialLabel}:${l.r.toFixed(2)},${l.g.toFixed(2)},${l.b.toFixed(2)} d=${f.toFixed(1)}`)}let c=s/Math.max(1e-4,o);return{sampleReadout:`samples: ${r.join(` | `)}`,maxChroma:i,energyRatio:c,reasonLine:Je(i,c)}},l=()=>{Ye(a),a=null,o=null};return{app:e,shaderErrors:r,get loaded(){return o},loadBundle:s,renderFrame:c,disposeLoaded:l}}function Ve(e){let t=[];return e.engine.onEffectErrorObservable.add(({errors:e})=>{let n=typeof e==`string`?e:String(e);t.push($(n).slice(0,220))}),t}async function He(e){let t=await fetch(Z(e));if(t.ok)return p(await t.arrayBuffer());let n=await Ue(e);if(n)return p(n);if(!t.ok)throw Error(`Could not fetch ${e}: HTTP ${t.status}.`);return p(await t.arrayBuffer())}async function Ue(e){let t=await fetch(Z(`${e}.parts.json`));if(!t.ok)return null;let n=await t.json();if(!Array.isArray(n.chunks)||n.chunks.length===0)throw Error(`Invalid chunk manifest for ${e}.`);let r=e.includes(`/`)?e.slice(0,e.lastIndexOf(`/`)+1):``,i=[],a=0;for(let e of n.chunks){let t=await fetch(Z(`${r}${e}`));if(!t.ok)throw Error(`Could not fetch ${e}: HTTP ${t.status}.`);let n=new Uint8Array(await t.arrayBuffer());i.push(n),a+=n.byteLength}if(Number.isFinite(n.size)&&n.size!==a)throw Error(`Chunked bundle size mismatch for ${e}: expected ${n.size}, got ${a}.`);let o=new Uint8Array(a),s=0;for(let e of i)o.set(e,s),s+=e.byteLength;return o.buffer}function We(e){let t=e.bundle;return`${e.sourceLabel}: ${g(t)}. ${y(t)}. Static surface lightmap ${e.shadowMaskTexture?`on`:t.shadowMask?`off`:`missing`}. Sponza meshes ${e.staticAudit.visibleMeshCount}/${e.staticAudit.meshCount} visible, vertices ${e.staticAudit.vertexCount}.`}function Ge(e,t){return`${e.staticAudit.pbrMaterialCount}/${e.staticAudit.materialCount} static PBR material(s), ${e.staticPluginCount} baked surface plugin(s), ${e.dynamicPluginCount} dynamic VLM plugin(s), ${e.dynamicLightCount} dynamic direct light(s), compiled ${e.compileAudit.compiledCount}/${e.compileAudit.checkedCount}, shader errors ${t}, static lightmap ${e.shadowMaskTexture?`bound`:`not bound`}, CPU static preview ${e.cpuPreviewCount}.`}function Ke(e){return`Loaded direct bundle and compiled ${e.compileAudit.compiledCount} Sponza material(s).`}function qe(e,t){return[...e.compileAudit.errors,...t].slice(0,2).join(` | `)}function Je(e,t){return e<.08&&t<1.35?`Weak visible change: the bundle stores smoothed irradiance probes, samples are clamped inside the volume, and the bake includes indirect/bounced energy instead of raw point-light falloff.`:`Sample variation is present: max channel spread ${e.toFixed(2)}, brightness ratio ${t.toFixed(2)}. Trilinear probe interpolation still smooths local point-light color changes.`}function Ye(e){if(e){Le(e.dynamicLighting);for(let t of e.dynamicObjects)t.material.dispose(),t.mesh.dispose();for(let t of e.staticCpuPreviewMaterials)t.material.dispose();X(e.volumeTexture),X(e.detailVolumeTexture),Xe(e.shadowMaskTexture)}}function X(e){for(let t of e?.shTextures??[])t.dispose()}function Xe(e){e?.texture.dispose(),e?.lightTexture.dispose(),e?.depthTexture.dispose()}function Ze(e,t){let n=new Set,r=0,i=0,a=0;for(let t of e)t.isEnabled()&&(r+=1),t.isVisible&&t.visibility>0&&(i+=1),a+=t.getTotalVertices(),Q(t.material)&&n.add(t.material);let o=[...n];return{meshCount:e.length,enabledMeshCount:r,visibleMeshCount:i,vertexCount:a,materialCount:o.length,pbrMaterialCount:o.filter(ot).length,pluginCount:t}}async function Qe(e){let t=new Map;for(let n of e)!Q(n.material)||!ot(n.material)||t.has(n.material)||t.set(n.material,n);let n=[...t.entries()].slice(0,ze),r=[],i=0;for(let[e,t]of n)try{await e.forceCompilationAsync(t),i+=1}catch(t){r.push(`${e.name||e.getClassName()}: ${$(t.message)}`)}return{checkedCount:n.length,compiledCount:i,errors:r}}function $e(e,t,n,r){let i=new Map,o=[];for(let s of e){let e=Q(s.material)?s.material:null,c=e?et(s,e,i):new f(`direct-preview-static-${s.name}`,s.getScene()),l=rt(s),u={material:c,samplePosition:l};c.backFaceCulling=e?.backFaceCulling??!1,c.disableLighting=!0,c.specularColor=a.Black(),c.emissiveColor=nt(l,t,n,r),s.material=c,o.push(u)}return o}function et(e,t,n){let r=n.get(t);if(r)return r;let i=new f(`direct-preview-static-${t.name||e.name}`,e.getScene()),o=t;return i.diffuseTexture=o.albedoTexture??o.baseColorTexture??o.diffuseTexture??null,i.diffuseColor=o.albedoColor?.clone()??o.baseColor?.clone()??o.diffuseColor?.clone()??new a(.72,.7,.66),i.alpha=t.alpha,i.transparencyMode=t.transparencyMode,i.needDepthPrePass=t.needDepthPrePass,n.set(t,i),i}function tt(e,t,n,r){for(let i of e)i.material.emissiveColor=nt(i.samplePosition,t,n,r)}function nt(e,t,n,r){return at(m(n&&q(n,e)?n:t,e).ambient.scale(r*.85))}function rt(e){e.computeWorldMatrix(!0);let t=e.getBoundingInfo().boundingBox;return t.minimumWorld.add(t.maximumWorld).scale(.5)}function it(e,t,r){if(t.length===0)return;let i=t.reduce((e,t)=>e.add(t.center),n.Zero()).scale(1/t.length),a=new n(r.bounds.max[0]-r.bounds.min[0],r.bounds.max[1]-r.bounds.min[1],r.bounds.max[2]-r.bounds.min[2]);e.setTarget(J(i,r)),e.alpha=Math.PI*.74,e.beta=Math.PI*.36,e.radius=st(Math.max(a.x,a.z)*.46,10,24)}function at(e){let t=.18,n=new a(1-Math.exp(-Math.max(0,e.r)*t),1-Math.exp(-Math.max(0,e.g)*t),1-Math.exp(-Math.max(0,e.b)*t)),r=.08;return new a(Math.max(r,n.r),Math.max(r,n.g),Math.max(r,n.b))}function Z(e){return`/Babylon-LPV-Research/${e}`.replace(/\/{2,}/g,`/`)}function Q(e){return!!(e&&typeof e==`object`&&`getClassName`in e)}function ot(e){return e.getClassName().includes(`PBR`)}function $(e){return e.replace(/\s+/g,` `).trim()}function st(e,t,n){return Math.min(n,Math.max(t,e))}export{We as a,Ke as i,qe as n,Ve as o,Ge as r,He as s,Be as t};