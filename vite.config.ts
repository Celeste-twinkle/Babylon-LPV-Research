import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : './',
  resolve: {
    dedupe: ['@babylonjs/core'],
  },
  server: {
    watch: {
      // Native Windows file notifications can miss atomic replacements performed by
      // editors and patch tools, leaving different modules in Vite's graph out of sync.
      usePolling: process.platform === 'win32',
      interval: 100,
    },
  },
  optimizeDeps: {
    force: true,
    entries: ['*.html'],
    holdUntilCrawlEnd: true,
    ignoreOutdatedRequests: true,
    include: [
      '@babylonjs/core/Buffers/buffer',
      '@babylonjs/core/Buffers/buffer.align',
      '@babylonjs/core/Buffers/storageBuffer',
      '@babylonjs/core/Compute/computeShader',
      '@babylonjs/core/Engines/webgpuEngine',
      '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader',
      '@babylonjs/core/Misc/rgbdTextureTools',
      '@babylonjs/core/Shaders/rgbdDecode.fragment',
      '@babylonjs/core/ShadersWGSL/rgbdDecode.fragment',
    ],
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        bake: resolve(__dirname, 'bake.html'),
        directPreview: resolve(__dirname, 'direct-preview.html'),
        directPreviewWebgl: resolve(__dirname, 'direct-preview-webgl.html'),
        directPreviewWebgpu: resolve(__dirname, 'direct-preview-webgpu.html'),
        validate: resolve(__dirname, 'validate.html'),
        validateWebgl: resolve(__dirname, 'validate-webgl.html'),
        validateWebgpu: resolve(__dirname, 'validate-webgpu.html'),
      },
    },
  },
})
