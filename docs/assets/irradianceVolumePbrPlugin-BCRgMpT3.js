import{o as e}from"./math.vector.pure-D3Yk2YK3.js";import{o as t,p as n}from"./sponzaScene-bJ_EwyGQ.js";import{t as r}from"./material.pure-ChDWsiRI.js";import{n as i}from"./texture.pure-BTPaNx8I.js";import{n as a,r as o}from"./material.detailMapConfiguration-P84SL1VO.js";import{t as s}from"./constants-FfqMFcYa.js";import{t as c}from"./baseTexture.polynomial.pure-CyIKFXhK.js";c(),o();var l;(function(e){e[e.GLSL=0]=`GLSL`,e[e.WGSL=1]=`WGSL`})(l||={});var u=class extends a{_resource=null;_intensity=1;constructor(e){super(e,`IrradianceVolumePbr`,210,{IVOL_PBR:!1})}get intensity(){return this._intensity}set intensity(e){this._intensity=Math.max(0,e)}setVolume(e){let t=this._resource!==null;this._resource=e;let n=e!==null;t!==n&&this._enable(n),this.markAllDefinesAsDirty()}isCompatible(e){return e===l.GLSL}isReadyForSubMesh(){return(this._resource?.ambientTexture.isReady()??!0)&&(this._resource?.directionTexture.isReady()??!0)}prepareDefines(e){e.IVOL_PBR=this._resource!==null}bindForSubMesh(e,t,n,r){this._resource&&(e.updateVector3(`ivolMin`,this._resource.boundsMin),e.updateVector3(`ivolMax`,this._resource.boundsMax),e.updateVector3(`ivolResolution`,this._resource.resolution),e.updateFloat(`ivolIntensity`,this._intensity),e.setTexture(`ivolAmbientTexture`,this._resource.ambientTexture),e.setTexture(`ivolDirectionTexture`,this._resource.directionTexture))}hasTexture(e){return this._resource?.ambientTexture===e||this._resource?.directionTexture===e}getActiveTextures(e){this._resource&&e.push(this._resource.ambientTexture,this._resource.directionTexture)}getSamplers(e){e.push(`ivolAmbientTexture`,`ivolDirectionTexture`)}getUniforms(){return{ubo:[{name:`ivolMin`,size:3,type:`vec3`},{name:`ivolMax`,size:3,type:`vec3`},{name:`ivolResolution`,size:3,type:`vec3`},{name:`ivolIntensity`,size:1,type:`float`}]}}getCustomCode(e,t=l.GLSL){return e!==`fragment`||t!==l.GLSL?null:{CUSTOM_FRAGMENT_DEFINITIONS:`
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
`,CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION:`
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
`}}},d=(r,a)=>{let[o,c,l]=a.resolution,u=c*l,d=new Float32Array(o*u*4),f=new Float32Array(o*u*4);for(let e=0;e<l;e+=1)for(let t=0;t<c;t+=1)for(let r=0;r<o;r+=1){let i=n(r,t,e,a.resolution),s=(r+(t+e*c)*o)*4,l=g(a,i),u=_(a,i),p=y(l),m=p>0?Math.min(.92,Math.max(0,u.intensity/p)):0;d[s]=l[0],d[s+1]=l[1],d[s+2]=l[2],d[s+3]=m,f[s]=u.direction[0],f[s+1]=u.direction[1],f[s+2]=u.direction[2],f[s+3]=u.intensity}let p=t.CreateRGBATexture(d,o,u,r,!1,!1,i.NEAREST_SAMPLINGMODE,s.TEXTURETYPE_FLOAT),m=t.CreateRGBATexture(f,o,u,r,!1,!1,i.NEAREST_SAMPLINGMODE,s.TEXTURETYPE_FLOAT);return p.name=`ivol-ambient-atlas-${o}x${u}`,p.wrapU=i.CLAMP_ADDRESSMODE,p.wrapV=i.CLAMP_ADDRESSMODE,m.name=`ivol-direction-atlas-${o}x${u}`,m.wrapU=i.CLAMP_ADDRESSMODE,m.wrapV=i.CLAMP_ADDRESSMODE,{ambientTexture:p,directionTexture:m,boundsMin:new e(a.bounds.min[0],a.bounds.min[1],a.bounds.min[2]),boundsMax:new e(a.bounds.max[0],a.bounds.max[1],a.bounds.max[2]),resolution:new e(a.resolution[0],a.resolution[1],a.resolution[2])}},f=e=>{let t=new Set;for(let n of e){let e=n.material;e instanceof r&&h(e)&&t.add(e)}return[...t].map(e=>new u(e))},p=(e,t,n)=>{for(let r of e)r.intensity=n,r.setVolume(t)},m=(e,t)=>{for(let n of e)n.intensity=t},h=e=>e.getClassName().includes(`PBR`),g=(e,t)=>{if(`kind`in e){let n=t*16;return[e.payload[n],e.payload[n+1],e.payload[n+2]]}return e.probes[t].ambient},_=(e,t)=>{if(`kind`in e){let n=t*16;return{direction:v([e.payload[n+12],e.payload[n+13],e.payload[n+14]]),intensity:Math.max(0,e.payload[n+15])}}let n=e.probes[t];return{direction:v(n.dominantDirection),intensity:Math.max(0,n.dominantIntensity)}},v=e=>{let t=Math.hypot(e[0],e[1],e[2]);return t<1e-5?[0,1,0]:[e[0]/t,e[1]/t,e[2]/t]},y=e=>Math.max(0,e[0]*.2126+e[1]*.7152+e[2]*.0722);export{p as a,m as i,d as n,f as r,u as t};