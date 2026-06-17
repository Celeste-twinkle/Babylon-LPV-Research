import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        bake: resolve(__dirname, 'bake.html'),
        directPreview: resolve(__dirname, 'direct-preview.html'),
        validate: resolve(__dirname, 'validate.html'),
        validateWebgl: resolve(__dirname, 'validate-webgl.html'),
        validateWebgpu: resolve(__dirname, 'validate-webgpu.html'),
      },
    },
  },
})
