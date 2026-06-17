# Babylon.js IrradianceVolume Research

TypeScript front-end research sandbox for Babylon.js IrradianceVolume / Light Probe Volume experiments.

The current build is a two-page Sponza workflow rather than a Babylon engine feature patch:

- `bake.html` loads Sponza and generates an MVP binary IrradianceVolume asset.
- `validate.html` loads the same Sponza scene and samples an imported `.ivol` file on dynamic objects.

The current WebGPU bake path uses Babylon physical lights, dispatches a compute shader over a regular probe grid, and writes a fixed-layout `.ivol` file. The `.ivol` payload is directly viewable as `Float32Array` data, avoiding JSON decode or object expansion at runtime.

The CPU bake path remains as a reference fallback. The current WebGPU pass is still a direct-light probe baker, not a complete Lightmass-style multi-bounce global illumination baker. Geometry occlusion acceleration, emissive surfaces, material albedo, adaptive bricks, and SH de-ringing are the next steps.

## Stack

- Vite
- TypeScript
- Babylon.js
- lil-gui
- GitHub Pages workflow

## Local Development

```bash
npm install
npm run dev
```

Open:

- `http://localhost:5173/bake.html`
- `http://localhost:5173/validate.html`

Workflow:

1. Open `bake.html`.
2. Click `Bake WebGPU .ivol`.
3. Click `Download asset`.
4. Open `validate.html`.
5. Click `Upload asset` and select the downloaded `.ivol` file.

## Build

```bash
npm run build
npm run preview
```

The static output is written to `dist`.

## GitHub Pages

1. Push this project to a GitHub repository.
2. In repository settings, open `Pages`.
3. Set the source to `GitHub Actions`.
4. Push to the `main` branch.

The workflow in `.github/workflows/deploy.yml` builds the Vite app and publishes `dist`.

## Research Path

- Replace ambient RGB + dominant direction with L1/L2 spherical harmonics per probe.
- Add static-geometry occlusion to the WebGPU compute bake using BVH, voxel grid, or surfel/RSM intermediates.
- Add emissive materials, material albedo, and environment lighting.
- Add a real multi-bounce bake path or import baked probe data from Blender, Unity, or Babylon Editor.
- Add UE-style adaptive 4x4x4 bricks: denser around static geometry, coarser in empty space.
- Move runtime sampling from material-color updates into a PBR material plugin or engine shader define.
- Compare 3D texture storage against 2D atlas fallback for WebGL2 and WebGPU.
