# Babylon.js L1 Irradiance Volumes

Experimental Babylon.js port of the core [VRCLightVolumes](https://github.com/REDSIM/VRCLightVolumes) irradiance-volume representation and shading path.

The project deliberately has no legacy asset compatibility:

- Baking requires WebGPU compute.
- Runtime rendering supports WebGPU and WebGL2 through the same GLSL material plugin.
- Assets contain convolved L1 spherical harmonics only: L0 RGB plus one XYZ L1 vector for each RGB channel.
- Base and detail volumes share one padded half-float 3D atlas and one `sampler3D`.
- Static Sponza materials and moving PBR receivers use the same runtime volume path.

## Runtime layout

Each `.ivol` probe stores 12 little-endian `float32` values:

| Offset | Data |
| --- | --- |
| 0..2 | L0 RGB |
| 3..5 | L1 X coefficient, RGB |
| 6..8 | L1 Y coefficient, RGB |
| 9..11 | L1 Z coefficient, RGB |

At upload time the data is converted to the same three-island RGBA packing used by VRCLightVolumes:

| Island | RGBA |
| --- | --- |
| 0 | `L0.r, L0.g, L0.b, L1r.z` |
| 1 | `L1r.x, L1g.x, L1b.x, L1g.z` |
| 2 | `L1r.y, L1g.y, L1b.y, L1b.z` |

All islands from the base and optional detail volume are packed into one 3D texture. One-voxel borders prevent trilinear filtering from bleeding between islands. A material evaluates diffuse irradiance as `max(L0 + dot(L1, normal), 0)` and uses the full per-channel VRCLightVolumes GGX specular model by default. The faster dominant-direction model remains an optional material variant. Volume diffuse respects metallic attenuation, while volume specular uses Babylon's RGB F0; both paths apply material ambient occlusion with the same weighting as the reference PBR shader.

The preview and validation pages expose the VRCLightVolumes material switches for volume speculars, dominant-direction speculars, and world-space normal bias. Speculars are enabled and dominant-direction speculars are disabled by default. The Sponza pages use a `0.3` world-unit normal bias (approximately one cell at the default `3 voxels/m`) so static surfaces do not blend with probes behind their walls or floors; it remains user-adjustable.

HDR volume data is never tone-mapped inside the asset. Bake, preview, and validation viewports use ACES tone mapping with an independent display exposure in EV, so bright probes retain energy without clipping the display. Volume intensity remains a linear lighting multiplier with a neutral default of `1`.

## WebGPU baker

The bake page:

- matches the VRCLightVolumes authoring defaults for adaptive resolution (`3 voxels/m`), denoising, invalid-probe dilation (`1` iteration, `0.1` backface bias), and EV-based color correction;
- builds a triangle BVH from static world geometry;
- reads material base-color textures and uses their linear-space average for bounced light;
- relocates probes away from nearby geometry;
- traces hard or radius-softened point lights with visibility;
- treats point-light intensity as candela and projects Lambertian outgoing radiance `I / (pi * distance^2)` into L1 SH;
- traces configurable indirect bounces;
- performs visibility-aware spatial denoising;
- writes compact base/detail `.ivol` chunks into one `.ivpack` bundle.

Manual XYZ resolution is used when adaptive resolution is disabled. The page shows the effective grid, asset size, temporary GPU probe memory, and safety-budget violations before baking. The detail volume is an optional Babylon-specific extension and is disabled by default.

Probe visibility and relocation values are temporary bake data. They are not serialized or sampled at runtime.

## Run locally

```bash
npm install
npm run dev
```

Open:

- `http://localhost:5173/bake.html` — configure and bake on WebGPU.
- `http://localhost:5173/direct-preview-webgl.html` — checked-in bundle on WebGL2.
- `http://localhost:5173/direct-preview-webgpu.html` — checked-in bundle on WebGPU.
- `http://localhost:5173/validate-webgl.html` — upload and validate a bundle on WebGL2.
- `http://localhost:5173/validate-webgpu.html` — upload and validate a bundle on WebGPU.

Use `npm run typecheck` and `npm run build` for verification.

## Current research scope

This repository targets baked irradiance-volume lighting rather than every Unity/VRChat management feature in VRCLightVolumes. The implemented port covers its L1 SH representation, three-island packing, hardware trilinear sampling, overlapping base/detail volume blending, full per-channel specular model, and optional dominant-direction specular model. Runtime analytic-light arrays, cookies, rotated/additive volume authoring, and separate four-channel shadowmask volumes are outside the current Sponza bake workflow.

The WebGPU baker currently uses material-average albedo rather than per-ray UV texture lookup, and does not yet treat emissive surfaces or an HDR environment as light sources.

## Attribution

The SH packing, evaluation, and full/dominant-direction specular models are derived from VRCLightVolumes by RED_SIM. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
