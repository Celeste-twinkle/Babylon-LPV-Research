import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader'

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import type { Light } from '@babylonjs/core/Lights/light'
import { ComputeShader } from '@babylonjs/core/Compute/computeShader'
import { Constants } from '@babylonjs/core/Engines/constants'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Material } from '@babylonjs/core/Materials/material'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { StorageBuffer } from '@babylonjs/core/Buffers/storageBuffer'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'

import type { IrradianceVolumeData, Vec3Tuple } from './irradianceVolume'
import {
  IVOL_PROBE_STRIDE_FLOATS,
  IVOL_HEADER_BYTES,
  createIvolBinary,
} from './irradianceVolume'

export type WebGPUBakeInput = {
  engine: AbstractEngine
  bounds: IrradianceVolumeData['bounds']
  resolution: Vec3Tuple
  lights: Light[]
  geometry: AbstractMesh[]
  exposure: number
  bounces: number
  areaSamples?: number
  bounceRayCount?: number
  batchSize?: number
  onProgress?: (percent: number, message: string) => void
}

export type WebGPUBakeResult = {
  binary: ArrayBuffer
  payload: Float32Array
  gpuSupported: boolean
}

const MAX_LIGHTS = 8
const LIGHT_STRIDE_FLOATS = 16
const TRIANGLE_STRIDE_FLOATS = 16
const BVH_NODE_STRIDE_FLOATS = 12
const BVH_LEAF_SIZE = 8
const DEFAULT_BATCH_SIZE = 512
const READBACK_CHUNK_BYTES = 1024 * 1024
const SHADER_READY_TIMEOUT_MS = 8000
const READBACK_TIMEOUT_MS = 600000
const GPU_BUFFER_USAGE_MAP_READ = 0x0001
const GPU_BUFFER_USAGE_COPY_DST = 0x0008
const GPU_MAP_MODE_READ = 0x0001
const COMPUTE_EFFECT_MISSING_ERROR = `Babylon failed to create the WebGPU compute effect for the irradiance bake shader.`

export const canUseWebGPUCompute = (engine: AbstractEngine): boolean =>
  engine.getCaps().supportComputeShaders === true

export const bakeIrradianceVolumeWebGPU = async (
  input: WebGPUBakeInput,
): Promise<WebGPUBakeResult> => {
  if (!canUseWebGPUCompute(input.engine)) {
    throw new Error('WebGPU compute shaders are not available in this browser/engine.')
  }

  const engine = input.engine as WebGPUEngine
  const probeCount = input.resolution[0] * input.resolution[1] * input.resolution[2]
  const batchSize = clampBatchSize(input.batchSize, probeCount)
  const batchCount = Math.ceil(probeCount / batchSize)
  const payloadBytes = probeCount * IVOL_PROBE_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT
  const params = createParams(input)
  const lightData = createLightBuffer(input.lights)
  const report = (percent: number, message: string): void => {
    input.onProgress?.(percent, message)
  }

  report(10, 'Building static mesh BVH for ray occlusion.')
  const geometryData = createGeometryBuffers(input.geometry)
  params[14] = geometryData.triangleCount
  params[15] = geometryData.nodeCount
  params[16] = computeMaxRayDistance(input.bounds)

  report(16, `Creating WebGPU buffers for ${geometryData.triangleCount} triangles.`)
  const paramsBuffer = new StorageBuffer(
    engine,
    params.byteLength,
    Constants.BUFFER_CREATIONFLAG_READWRITE,
    'ivol-bake-params',
  )
  const lightBuffer = new StorageBuffer(
    engine,
    lightData.byteLength,
    Constants.BUFFER_CREATIONFLAG_READWRITE,
    'ivol-bake-lights',
  )
  const outputBuffer = new StorageBuffer(
    engine,
    payloadBytes,
    Constants.BUFFER_CREATIONFLAG_READWRITE,
    'ivol-bake-output',
  )
  const triangleBuffer = new StorageBuffer(
    engine,
    geometryData.triangles.byteLength,
    Constants.BUFFER_CREATIONFLAG_READWRITE,
    'ivol-bake-triangles',
  )
  const bvhBuffer = new StorageBuffer(
    engine,
    geometryData.nodes.byteLength,
    Constants.BUFFER_CREATIONFLAG_READWRITE,
    'ivol-bake-bvh',
  )

  paramsBuffer.update(params)
  lightBuffer.update(lightData)
  triangleBuffer.update(geometryData.triangles)
  bvhBuffer.update(geometryData.nodes)
  outputBuffer.clear()

  let compileError = ''
  const shader = new ComputeShader(
    'ivol-webgpu-bake',
    engine,
    { computeSource: WEBGPU_BAKE_SHADER },
    {
      bindingsMapping: {
        params: { group: 0, binding: 0 },
        lights: { group: 0, binding: 1 },
        outputData: { group: 0, binding: 2 },
        triangles: { group: 0, binding: 3 },
        bvhNodes: { group: 0, binding: 4 },
      },
    },
  )
  shader.onError = (_effect, errors) => {
    compileError = errors || 'Unknown WebGPU compute shader compilation error.'
  }

  try {
    shader.setStorageBuffer('params', paramsBuffer)
    shader.setStorageBuffer('lights', lightBuffer)
    shader.setStorageBuffer('outputData', outputBuffer)
    shader.setStorageBuffer('triangles', triangleBuffer)
    shader.setStorageBuffer('bvhNodes', bvhBuffer)

    report(24, 'Waiting for compute shader raytracing pipeline.')
    await waitForComputeShaderReady(shader, () => compileError, SHADER_READY_TIMEOUT_MS)

    report(32, `Baking ${probeCount} probes in ${batchCount} GPU batch(es).`)
    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batchOffset = batchIndex * batchSize
      const currentBatchSize = Math.min(batchSize, probeCount - batchOffset)
      const progressStart = 32 + (batchIndex / batchCount) * 54

      params[17] = batchOffset
      params[18] = currentBatchSize
      paramsBuffer.update(params)

      report(
        progressStart,
        `Queued GPU batch ${batchIndex + 1} / ${batchCount}: probes ${batchOffset + 1}-${batchOffset + currentBatchSize}.`,
      )
      if (!shader.dispatch(Math.ceil(currentBatchSize / 64))) {
        throw new Error(`WebGPU compute dispatch returned false for batch ${batchIndex + 1}.`)
      }
      await waitForSubmittedGpuWork(engine)

      report(
        32 + ((batchIndex + 1) / batchCount) * 54,
        `Completed GPU batch ${batchIndex + 1} / ${batchCount}.`,
      )
      await sleep(0)
    }

    report(88, 'Preparing chunked GPU readback.')
    const payload = await withTimeout(
      readStorageBufferInChunks(engine, outputBuffer, payloadBytes, report),
      READBACK_TIMEOUT_MS,
      'Timed out while reading the WebGPU irradiance payload.',
    )

    report(94, 'Packing binary .ivol payload.')
    const binary = createIvolBinary(input, payload)

    return {
      binary,
      payload: new Float32Array(binary, IVOL_HEADER_BYTES),
      gpuSupported: true,
    }
  } finally {
    paramsBuffer.dispose()
    lightBuffer.dispose()
    outputBuffer.dispose()
    triangleBuffer.dispose()
    bvhBuffer.dispose()
  }
}

const waitForComputeShaderReady = async (
  shader: ComputeShader,
  getCompileError: () => string,
  timeoutMs: number,
): Promise<void> => {
  const startTime = performance.now()

  while (performance.now() - startTime < timeoutMs) {
    if (getCompileError()) {
      throw new Error(`WebGPU compute shader failed to compile: ${getCompileError()}`)
    }

    if (isComputeShaderReady(shader, getCompileError)) {
      return
    }

    await sleep(16)
  }

  const compileError = getCompileError()
  if (compileError) {
    throw new Error(`WebGPU compute shader failed to compile: ${compileError}`)
  }

  throw new Error(`Timed out after ${timeoutMs}ms while waiting for the WebGPU compute shader to become ready.`)
}

const isComputeShaderReady = (
  shader: ComputeShader,
  getCompileError: () => string,
): boolean => {
  try {
    return shader.isReady()
  } catch (error) {
    const compileError = getCompileError()

    if (compileError) {
      throw new Error(`WebGPU compute shader failed to compile: ${compileError}`)
    }

    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('isReady')) {
      throw new Error(`${COMPUTE_EFFECT_MISSING_ERROR} Original error: ${message}`)
    }

    throw error
  }
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${message} (${timeoutMs}ms)`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

type FlushableWebGPUEngine = WebGPUEngine & {
  flushFramebuffer?: (fromEndFrame?: boolean) => void
  _device?: GPUDevice
}

const waitForSubmittedGpuWork = async (engine: WebGPUEngine): Promise<void> => {
  const flushable = engine as FlushableWebGPUEngine

  flushable.flushFramebuffer?.(false)

  const queue = flushable._device?.queue
  if (typeof queue?.onSubmittedWorkDone === 'function') {
    await queue.onSubmittedWorkDone()
  } else {
    await sleep(0)
  }
}

const readStorageBufferInChunks = async (
  engine: WebGPUEngine,
  source: StorageBuffer,
  byteLength: number,
  report: (percent: number, message: string) => void,
): Promise<Float32Array> => {
  const flushable = engine as FlushableWebGPUEngine
  const device = flushable._device
  const sourceBuffer = source.getBuffer().underlyingResource as GPUBuffer | undefined

  if (!device || !sourceBuffer) {
    report(88, 'Falling back to Babylon storage-buffer readback.')
    const readback = await source.read(
      0,
      byteLength,
      new Float32Array(byteLength / Float32Array.BYTES_PER_ELEMENT),
      true,
    )

    return readback instanceof Float32Array
      ? readback
      : new Float32Array(readback.buffer, readback.byteOffset, readback.byteLength / Float32Array.BYTES_PER_ELEMENT)
  }

  flushable.flushFramebuffer?.(false)

  const bytes = new Uint8Array(byteLength)
  const chunkBytes = Math.max(Float32Array.BYTES_PER_ELEMENT, alignDownToCopySize(READBACK_CHUNK_BYTES))
  const chunkCount = Math.ceil(byteLength / chunkBytes)

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const byteOffset = chunkIndex * chunkBytes
    const currentBytes = byteLength - byteOffset < chunkBytes ? byteLength - byteOffset : chunkBytes
    const progressStart = 88 + (chunkIndex / chunkCount) * 6
    const progressEnd = 88 + ((chunkIndex + 1) / chunkCount) * 6

    report(
      progressStart,
      `Reading GPU payload chunk ${chunkIndex + 1} / ${chunkCount}.`,
    )

    const staging = device.createBuffer({
      label: `ivol-readback-${chunkIndex + 1}`,
      size: currentBytes,
      usage: GPU_BUFFER_USAGE_MAP_READ | GPU_BUFFER_USAGE_COPY_DST,
    })
    let mapped = false

    try {
      const encoder = device.createCommandEncoder({ label: `ivol-readback-copy-${chunkIndex + 1}` })
      encoder.copyBufferToBuffer(sourceBuffer, byteOffset, staging, 0, currentBytes)
      device.queue.submit([encoder.finish()])

      await waitWithReadbackPulse(
        staging.mapAsync(GPU_MAP_MODE_READ, 0, currentBytes),
        (seconds) => {
          report(
            Math.min(progressEnd - 0.1, progressStart + 0.4),
            `Waiting for GPU readback chunk ${chunkIndex + 1} / ${chunkCount} (${seconds}s).`,
          )
        },
      )
      mapped = true

      bytes.set(new Uint8Array(staging.getMappedRange(0, currentBytes)), byteOffset)
      report(progressEnd, `Read GPU payload chunk ${chunkIndex + 1} / ${chunkCount}.`)
    } finally {
      if (mapped) {
        staging.unmap()
      }
      staging.destroy()
    }

    await sleep(0)
  }

  return new Float32Array(bytes.buffer)
}

const alignDownToCopySize = (byteLength: number): number =>
  Math.max(Float32Array.BYTES_PER_ELEMENT, byteLength - (byteLength % Float32Array.BYTES_PER_ELEMENT))

const waitWithReadbackPulse = async <T>(
  promise: Promise<T>,
  onPulse: (seconds: number) => void,
): Promise<T> => {
  const startedAt = performance.now()
  let intervalId: number | undefined

  intervalId = window.setInterval(() => {
    onPulse(Math.max(1, Math.round((performance.now() - startedAt) / 1000)))
  }, 1000)

  try {
    return await promise
  } finally {
    if (intervalId !== undefined) {
      window.clearInterval(intervalId)
    }
  }
}

const clampBatchSize = (value: number | undefined, probeCount: number): number => {
  const requested = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_BATCH_SIZE

  return Math.max(1, Math.min(probeCount, Math.max(64, requested)))
}

const clampInteger = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)))

const createParams = (input: WebGPUBakeInput): Float32Array => {
  const params = new Float32Array(32)
  params[0] = input.resolution[0]
  params[1] = input.resolution[1]
  params[2] = input.resolution[2]
  params[3] = Math.min(MAX_LIGHTS, input.lights.length)
  params[4] = input.bounds.min[0]
  params[5] = input.bounds.min[1]
  params[6] = input.bounds.min[2]
  params[8] = input.bounds.max[0]
  params[9] = input.bounds.max[1]
  params[10] = input.bounds.max[2]
  params[12] = input.exposure
  params[13] = input.bounces
  params[17] = 0
  params[18] = input.resolution[0] * input.resolution[1] * input.resolution[2]
  params[19] = clampInteger(input.areaSamples ?? 4, 1, 8)
  params[20] = clampInteger(input.bounceRayCount ?? 4, 1, 8)

  return params
}

type TriangleRecord = {
  v0: Vector3
  v1: Vector3
  v2: Vector3
  normal: Vector3
  albedo: Vector3
  centroid: Vector3
  min: Vector3
  max: Vector3
}

type BvhNodeBuild = {
  min: Vector3
  max: Vector3
  left: number
  right: number
  start: number
  count: number
}

type GeometryBuffers = {
  triangles: Float32Array
  nodes: Float32Array
  triangleCount: number
  nodeCount: number
}

const createGeometryBuffers = (meshes: AbstractMesh[]): GeometryBuffers => {
  const sourceTriangles = collectTriangles(meshes)

  if (sourceTriangles.length === 0) {
    return createEmptyGeometryBuffers()
  }

  const orderedTriangles: TriangleRecord[] = []
  const nodes: BvhNodeBuild[] = []
  buildBvhNode(sourceTriangles, orderedTriangles, nodes)

  const triangles = new Float32Array(orderedTriangles.length * TRIANGLE_STRIDE_FLOATS)
  for (let index = 0; index < orderedTriangles.length; index += 1) {
    writeTriangle(triangles, index, orderedTriangles[index])
  }

  const packedNodes = new Float32Array(nodes.length * BVH_NODE_STRIDE_FLOATS)
  for (let index = 0; index < nodes.length; index += 1) {
    writeBvhNode(packedNodes, index, nodes[index])
  }

  return {
    triangles,
    nodes: packedNodes,
    triangleCount: orderedTriangles.length,
    nodeCount: nodes.length,
  }
}

const collectTriangles = (meshes: AbstractMesh[]): TriangleRecord[] => {
  const triangles: TriangleRecord[] = []

  for (const mesh of meshes) {
    if (!mesh.isEnabled() || !mesh.isVisible || mesh.getTotalVertices() === 0) {
      continue
    }

    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
    const indices = mesh.getIndices()

    if (!positions || !indices || positions.length < 9 || indices.length < 3) {
      continue
    }

    const world = mesh.computeWorldMatrix(true)
    const albedo = getMaterialAlbedo(mesh.material)

    for (let index = 0; index < indices.length; index += 3) {
      const i0 = indices[index] * 3
      const i1 = indices[index + 1] * 3
      const i2 = indices[index + 2] * 3
      const v0 = Vector3.TransformCoordinates(
        new Vector3(positions[i0], positions[i0 + 1], positions[i0 + 2]),
        world,
      )
      const v1 = Vector3.TransformCoordinates(
        new Vector3(positions[i1], positions[i1 + 1], positions[i1 + 2]),
        world,
      )
      const v2 = Vector3.TransformCoordinates(
        new Vector3(positions[i2], positions[i2 + 1], positions[i2 + 2]),
        world,
      )
      const edge1 = v1.subtract(v0)
      const edge2 = v2.subtract(v0)
      const normal = Vector3.Cross(edge1, edge2)
      const area2 = normal.length()

      if (area2 < 0.000001) {
        continue
      }

      normal.scaleInPlace(1 / area2)
      const min = Vector3.Minimize(Vector3.Minimize(v0, v1), v2)
      const max = Vector3.Maximize(Vector3.Maximize(v0, v1), v2)
      const centroid = v0.add(v1).addInPlace(v2).scaleInPlace(1 / 3)

      triangles.push({ v0, v1, v2, normal, albedo, centroid, min, max })
    }
  }

  return triangles
}

const buildBvhNode = (
  triangles: TriangleRecord[],
  orderedTriangles: TriangleRecord[],
  nodes: BvhNodeBuild[],
): number => {
  const nodeIndex = nodes.length
  const bounds = computeTriangleBounds(triangles)
  nodes.push({
    min: bounds.min,
    max: bounds.max,
    left: -1,
    right: -1,
    start: 0,
    count: 0,
  })

  if (triangles.length <= BVH_LEAF_SIZE) {
    const start = orderedTriangles.length
    orderedTriangles.push(...triangles)
    nodes[nodeIndex].start = start
    nodes[nodeIndex].count = triangles.length

    return nodeIndex
  }

  const axis = getLongestAxis(bounds.max.subtract(bounds.min))
  const sorted = [...triangles].sort((a, b) => getAxis(a.centroid, axis) - getAxis(b.centroid, axis))
  const middle = Math.floor(sorted.length / 2)
  const left = buildBvhNode(sorted.slice(0, middle), orderedTriangles, nodes)
  const right = buildBvhNode(sorted.slice(middle), orderedTriangles, nodes)

  nodes[nodeIndex].left = left
  nodes[nodeIndex].right = right

  return nodeIndex
}

const computeTriangleBounds = (triangles: TriangleRecord[]): { min: Vector3; max: Vector3 } => {
  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  for (const triangle of triangles) {
    min.minimizeInPlace(triangle.min)
    max.maximizeInPlace(triangle.max)
  }

  return { min, max }
}

const writeTriangle = (data: Float32Array, index: number, triangle: TriangleRecord): void => {
  const base = index * TRIANGLE_STRIDE_FLOATS

  data[base] = triangle.v0.x
  data[base + 1] = triangle.v0.y
  data[base + 2] = triangle.v0.z
  data[base + 3] = triangle.normal.x
  data[base + 4] = triangle.v1.x
  data[base + 5] = triangle.v1.y
  data[base + 6] = triangle.v1.z
  data[base + 7] = triangle.normal.y
  data[base + 8] = triangle.v2.x
  data[base + 9] = triangle.v2.y
  data[base + 10] = triangle.v2.z
  data[base + 11] = triangle.normal.z
  data[base + 12] = triangle.albedo.x
  data[base + 13] = triangle.albedo.y
  data[base + 14] = triangle.albedo.z
  data[base + 15] = 0
}

const writeBvhNode = (data: Float32Array, index: number, node: BvhNodeBuild): void => {
  const base = index * BVH_NODE_STRIDE_FLOATS

  data[base] = node.min.x
  data[base + 1] = node.min.y
  data[base + 2] = node.min.z
  data[base + 3] = node.left
  data[base + 4] = node.max.x
  data[base + 5] = node.max.y
  data[base + 6] = node.max.z
  data[base + 7] = node.right
  data[base + 8] = node.start
  data[base + 9] = node.count
  data[base + 10] = node.count > 0 ? 1 : 0
  data[base + 11] = 0
}

const createEmptyGeometryBuffers = (): GeometryBuffers => ({
  triangles: new Float32Array(TRIANGLE_STRIDE_FLOATS),
  nodes: new Float32Array(BVH_NODE_STRIDE_FLOATS),
  triangleCount: 0,
  nodeCount: 0,
})

const getMaterialAlbedo = (material: AbstractMesh['material']): Vector3 => {
  if (!(material instanceof Material)) {
    return new Vector3(0.72, 0.72, 0.72)
  }

  const candidate = material as Material & {
    albedoColor?: { r: number; g: number; b: number }
    baseColor?: { r: number; g: number; b: number }
    diffuseColor?: { r: number; g: number; b: number }
  }
  const color = candidate.albedoColor ?? candidate.baseColor ?? candidate.diffuseColor

  if (!color) {
    return new Vector3(0.72, 0.72, 0.72)
  }

  return new Vector3(
    Math.min(1, Math.max(0.04, color.r)),
    Math.min(1, Math.max(0.04, color.g)),
    Math.min(1, Math.max(0.04, color.b)),
  )
}

const getLongestAxis = (size: Vector3): 0 | 1 | 2 => {
  if (size.x >= size.y && size.x >= size.z) {
    return 0
  }

  return size.y >= size.z ? 1 : 2
}

const getAxis = (vector: Vector3, axis: 0 | 1 | 2): number => {
  if (axis === 0) {
    return vector.x
  }

  return axis === 1 ? vector.y : vector.z
}

const computeMaxRayDistance = (bounds: IrradianceVolumeData['bounds']): number => {
  const size = new Vector3(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  )

  return Math.max(20, size.length() * 2.5)
}

const createLightBuffer = (lights: Light[]): Float32Array => {
  const data = new Float32Array(MAX_LIGHTS * LIGHT_STRIDE_FLOATS)
  const packedLights = lights.slice(0, MAX_LIGHTS)

  for (let index = 0; index < packedLights.length; index += 1) {
    const light = packedLights[index]
    const base = index * LIGHT_STRIDE_FLOATS
    data[base] = light.getTypeID()
    data[base + 1] = light.intensity
    data[base + 2] = 'range' in light ? Number(light.range) || 0 : 0
    data[base + 3] = light.isEnabled() ? 1 : 0
    data[base + 7] = readIvolSourceRadius(light)

    if (light instanceof DirectionalLight) {
      const directionToLight = light.direction.scale(-1).normalize()
      data[base + 4] = directionToLight.x
      data[base + 5] = directionToLight.y
      data[base + 6] = directionToLight.z
    } else if (light instanceof PointLight) {
      data[base + 4] = light.position.x
      data[base + 5] = light.position.y
      data[base + 6] = light.position.z
    } else if (light instanceof HemisphericLight) {
      const direction = light.direction.normalizeToNew()
      data[base + 4] = direction.x
      data[base + 5] = direction.y
      data[base + 6] = direction.z
    } else {
      const up = Vector3.Up()
      data[base + 4] = up.x
      data[base + 5] = up.y
      data[base + 6] = up.z
    }

    data[base + 8] = light.diffuse.r
    data[base + 9] = light.diffuse.g
    data[base + 10] = light.diffuse.b
  }

  return data
}

const readIvolSourceRadius = (light: Light): number => {
  const metadata = light.metadata

  if (metadata && typeof metadata === 'object' && 'ivolSourceRadius' in metadata) {
    const radius = Number((metadata as { ivolSourceRadius?: unknown }).ivolSourceRadius)

    return Number.isFinite(radius) ? Math.max(0, radius) : 0
  }

  return 0
}

const WEBGPU_BAKE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> params : array<f32>;
@group(0) @binding(1) var<storage, read> lights : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputData : array<f32>;
@group(0) @binding(3) var<storage, read> triangles : array<f32>;
@group(0) @binding(4) var<storage, read> bvhNodes : array<f32>;

const LIGHT_STRIDE : u32 = 16u;
const PROBE_STRIDE : u32 = 16u;
const TRIANGLE_STRIDE : u32 = 16u;
const BVH_NODE_STRIDE : u32 = 12u;
const BVH_STACK_SIZE : u32 = 64u;
const MAX_BOUNCE_RAY_COUNT : u32 = 8u;
const MAX_AREA_LIGHT_SAMPLE_COUNT : u32 = 8u;
const PI : f32 = 3.14159265359;
const GOLDEN_ANGLE : f32 = 2.39996322973;
const SHADOW_EPSILON : f32 = 0.006;
const BOUNCE_EPSILON : f32 = 0.025;
const BOUNCE_DECAY : f32 = 0.58;

struct TriangleHit {
  hit: bool,
  frontFacing: bool,
  t: f32,
  normal: vec3<f32>,
  albedo: vec3<f32>,
};

struct LightContribution {
  irradiance: vec3<f32>,
  dominantIntensity: f32,
  directionToLight: vec3<f32>,
};

fn saturate(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn safeNormalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let lengthSquared = dot(value, value);
  if (lengthSquared < 0.0000001) {
    return fallback;
  }

  return value * inverseSqrt(lengthSquared);
}

fn safeInverse(value: f32) -> f32 {
  if (abs(value) < 0.000001) {
    if (value < 0.0) {
      return -1000000.0;
    }

    return 1000000.0;
  }

  return 1.0 / value;
}

fn probePosition(index: u32) -> vec3<f32> {
  let rx = u32(params[0]);
  let ry = u32(params[1]);
  let rz = u32(params[2]);
  let xy = rx * ry;
  let z = index / xy;
  let rem = index - z * xy;
  let y = rem / rx;
  let x = rem - y * rx;
  let minBounds = vec3<f32>(params[4], params[5], params[6]);
  let maxBounds = vec3<f32>(params[8], params[9], params[10]);
  let denom = max(vec3<f32>(f32(rx - 1u), f32(ry - 1u), f32(rz - 1u)), vec3<f32>(1.0));
  let uvw = vec3<f32>(f32(x), f32(y), f32(z)) / denom;

  return mix(minBounds, maxBounds, uvw);
}

fn triangleV0(index: u32) -> vec3<f32> {
  let base = index * TRIANGLE_STRIDE;
  return vec3<f32>(triangles[base], triangles[base + 1u], triangles[base + 2u]);
}

fn triangleV1(index: u32) -> vec3<f32> {
  let base = index * TRIANGLE_STRIDE;
  return vec3<f32>(triangles[base + 4u], triangles[base + 5u], triangles[base + 6u]);
}

fn triangleV2(index: u32) -> vec3<f32> {
  let base = index * TRIANGLE_STRIDE;
  return vec3<f32>(triangles[base + 8u], triangles[base + 9u], triangles[base + 10u]);
}

fn triangleNormal(index: u32) -> vec3<f32> {
  let base = index * TRIANGLE_STRIDE;
  return safeNormalize(
    vec3<f32>(triangles[base + 3u], triangles[base + 7u], triangles[base + 11u]),
    vec3<f32>(0.0, 1.0, 0.0),
  );
}

fn triangleAlbedo(index: u32) -> vec3<f32> {
  let base = index * TRIANGLE_STRIDE;
  return clamp(
    vec3<f32>(triangles[base + 12u], triangles[base + 13u], triangles[base + 14u]),
    vec3<f32>(0.04),
    vec3<f32>(1.0),
  );
}

fn missHit(maxDistance: f32) -> TriangleHit {
  return TriangleHit(false, false, maxDistance, vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0));
}

fn intersectAabb(
  origin: vec3<f32>,
  direction: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  minT: f32,
  maxT: f32,
) -> bool {
  let invDirection = vec3<f32>(
    safeInverse(direction.x),
    safeInverse(direction.y),
    safeInverse(direction.z),
  );
  let t0 = (boundsMin - origin) * invDirection;
  let t1 = (boundsMax - origin) * invDirection;
  let tMin3 = min(t0, t1);
  let tMax3 = max(t0, t1);
  let nearT = max(max(tMin3.x, tMin3.y), max(tMin3.z, minT));
  let farT = min(min(tMax3.x, tMax3.y), min(tMax3.z, maxT));

  return farT >= nearT;
}

fn intersectTriangle(
  triangleIndex: u32,
  origin: vec3<f32>,
  direction: vec3<f32>,
  minT: f32,
  maxT: f32,
) -> TriangleHit {
  let v0 = triangleV0(triangleIndex);
  let v1 = triangleV1(triangleIndex);
  let v2 = triangleV2(triangleIndex);
  let edge1 = v1 - v0;
  let edge2 = v2 - v0;
  let pvec = cross(direction, edge2);
  let det = dot(edge1, pvec);

  if (abs(det) < 0.0000001) {
    return missHit(maxT);
  }

  let invDet = 1.0 / det;
  let tvec = origin - v0;
  let u = dot(tvec, pvec) * invDet;

  if (u < 0.0 || u > 1.0) {
    return missHit(maxT);
  }

  let qvec = cross(tvec, edge1);
  let v = dot(direction, qvec) * invDet;

  if (v < 0.0 || u + v > 1.0) {
    return missHit(maxT);
  }

  let t = dot(edge2, qvec) * invDet;

  if (t <= minT || t >= maxT) {
    return missHit(maxT);
  }

  let normal = triangleNormal(triangleIndex);
  let frontFacing = dot(normal, direction) < 0.0;

  return TriangleHit(true, frontFacing, t, normal, triangleAlbedo(triangleIndex));
}

fn traceRay(origin: vec3<f32>, direction: vec3<f32>, minT: f32, maxDistance: f32) -> TriangleHit {
  let nodeCount = u32(params[15]);
  if (nodeCount == 0u) {
    return missHit(maxDistance);
  }

  var closest = missHit(maxDistance);
  var stack: array<u32, 64>;
  var stackSize = 1u;
  stack[0] = 0u;

  loop {
    if (stackSize == 0u) {
      break;
    }

    stackSize = stackSize - 1u;
    let nodeIndex = stack[stackSize];
    if (nodeIndex >= nodeCount) {
      continue;
    }

    let nodeBase = nodeIndex * BVH_NODE_STRIDE;
    let boundsMin = vec3<f32>(bvhNodes[nodeBase], bvhNodes[nodeBase + 1u], bvhNodes[nodeBase + 2u]);
    let boundsMax = vec3<f32>(bvhNodes[nodeBase + 4u], bvhNodes[nodeBase + 5u], bvhNodes[nodeBase + 6u]);

    if (!intersectAabb(origin, direction, boundsMin, boundsMax, minT, closest.t)) {
      continue;
    }

    let isLeaf = bvhNodes[nodeBase + 10u] > 0.5;
    if (isLeaf) {
      let start = u32(bvhNodes[nodeBase + 8u]);
      let count = u32(bvhNodes[nodeBase + 9u]);
      for (var i = 0u; i < count; i = i + 1u) {
        let hit = intersectTriangle(start + i, origin, direction, minT, closest.t);
        if (hit.hit && hit.t < closest.t) {
          closest = hit;
        }
      }
    } else {
      let left = i32(bvhNodes[nodeBase + 3u]);
      let right = i32(bvhNodes[nodeBase + 7u]);
      if (left >= 0 && stackSize < BVH_STACK_SIZE) {
        stack[stackSize] = u32(left);
        stackSize = stackSize + 1u;
      }
      if (right >= 0 && stackSize < BVH_STACK_SIZE) {
        stack[stackSize] = u32(right);
        stackSize = stackSize + 1u;
      }
    }
  }

  return closest;
}

fn rayOccluded(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> bool {
  let triangleCount = u32(params[14]);
  if (triangleCount == 0u || maxDistance <= SHADOW_EPSILON * 2.0) {
    return false;
  }

  return traceRay(origin, direction, SHADOW_EPSILON, maxDistance).hit;
}

fn areaLightSampleCount(sourceRadius: f32) -> u32 {
  if (sourceRadius > 0.001) {
    return min(max(u32(params[19]), 1u), MAX_AREA_LIGHT_SAMPLE_COUNT);
  }

  return 1u;
}

fn areaLightSamplePosition(center: vec3<f32>, sourceRadius: f32, sampleIndex: u32, sampleCount: u32, seed: u32) -> vec3<f32> {
  if (sourceRadius <= 0.001 || sampleCount <= 1u) {
    return center;
  }

  let hasCenterSample = (sampleCount % 2u) == 1u;
  if (hasCenterSample && sampleIndex == 0u) {
    return center;
  }

  var pairSampleIndex = sampleIndex;
  if (hasCenterSample) {
    pairSampleIndex = sampleIndex - 1u;
  }

  let pairIndex = pairSampleIndex / 2u;
  let pairCount = max(sampleCount / 2u, 1u);
  let sample = f32(pairIndex) + 0.5;
  let count = max(f32(pairCount), 1.0);
  let z = 1.0 - 2.0 * sample / count;
  let radius = sqrt(max(0.0, 1.0 - z * z));
  let phi = GOLDEN_ANGLE * (sample + f32(seed & 1023u) * 0.037);
  let sign = select(1.0, -1.0, (pairSampleIndex % 2u) == 1u);
  let offset = vec3<f32>(cos(phi) * radius, z, sin(phi) * radius) * sourceRadius * sign;

  return center + offset;
}

fn lightContribution(lightIndex: u32, position: vec3<f32>) -> LightContribution {
  let base = lightIndex * LIGHT_STRIDE;
  let lightType = u32(lights[base]);
  let intensity = lights[base + 1u];
  let range = lights[base + 2u];
  let enabled = lights[base + 3u];
  let vector = vec3<f32>(lights[base + 4u], lights[base + 5u], lights[base + 6u]);
  let sourceRadius = max(lights[base + 7u], 0.0);
  let color = vec3<f32>(lights[base + 8u], lights[base + 9u], lights[base + 10u]);

  if (enabled < 0.5) {
    return LightContribution(vec3<f32>(0.0), 0.0, vec3<f32>(0.0, 1.0, 0.0));
  }

  if (lightType == 1u) {
    let directionToLight = normalize(vector);
    if (rayOccluded(position + directionToLight * SHADOW_EPSILON, directionToLight, params[16])) {
      return LightContribution(vec3<f32>(0.0), 0.0, directionToLight);
    }
    let skylikeVisibility = saturate(directionToLight.y * 0.5 + 0.5);
    let irradiance = color * intensity * 0.000018 * skylikeVisibility;
    return LightContribution(irradiance, length(irradiance), directionToLight);
  }

  if (lightType == 0u) {
    let sampleCount = areaLightSampleCount(sourceRadius);
    var irradiance = vec3<f32>(0.0);
    var weightedDirection = vec3<f32>(0.0);

    for (var sample = 0u; sample < MAX_AREA_LIGHT_SAMPLE_COUNT; sample = sample + 1u) {
      if (sample >= sampleCount) {
        break;
      }

      let samplePosition = areaLightSamplePosition(vector, sourceRadius, sample, sampleCount, lightIndex);
      let delta = samplePosition - position;
      let distanceSquared = max(dot(delta, delta), 0.08);
      let distance = sqrt(distanceSquared);
      let lightDirection = directionToLight(delta);
      let safeRange = max(range, 0.001);
      let normalizedDistance = distance / safeRange;
      let rangeAttenuation = saturate(1.0 - normalizedDistance * normalizedDistance);
      if (rangeAttenuation > 0.0 && !rayOccluded(position + lightDirection * SHADOW_EPSILON, lightDirection, distance - SHADOW_EPSILON * 2.0)) {
        let sampleIrradiance = color * intensity / (4.0 * PI * distanceSquared) * rangeAttenuation * rangeAttenuation * 2.4;
        irradiance = irradiance + sampleIrradiance;
        weightedDirection = weightedDirection + lightDirection * length(sampleIrradiance);
      }
    }

    irradiance = irradiance / f32(sampleCount);
    let fallbackDirection = directionToLight(vector - position);
    return LightContribution(irradiance, length(irradiance), safeNormalize(weightedDirection, fallbackDirection));
  }

  if (lightType == 3u) {
    let up = normalize(vector);
    let hemisphere = saturate(up.y * 0.5 + 0.5);
    let irradiance = color * intensity * 0.08 * hemisphere;
    return LightContribution(irradiance, length(irradiance), up);
  }

  return LightContribution(vec3<f32>(0.0), 0.0, vec3<f32>(0.0, 1.0, 0.0));
}

fn directionToLight(delta: vec3<f32>) -> vec3<f32> {
  return safeNormalize(delta, vec3<f32>(0.0, 1.0, 0.0));
}

fn surfaceLightContribution(lightIndex: u32, position: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let base = lightIndex * LIGHT_STRIDE;
  let lightType = u32(lights[base]);
  let intensity = lights[base + 1u];
  let range = lights[base + 2u];
  let enabled = lights[base + 3u];
  let vector = vec3<f32>(lights[base + 4u], lights[base + 5u], lights[base + 6u]);
  let sourceRadius = max(lights[base + 7u], 0.0);
  let color = vec3<f32>(lights[base + 8u], lights[base + 9u], lights[base + 10u]);

  if (enabled < 0.5) {
    return vec3<f32>(0.0);
  }

  if (lightType == 0u) {
    let sampleCount = areaLightSampleCount(sourceRadius);
    var irradiance = vec3<f32>(0.0);

    for (var sample = 0u; sample < MAX_AREA_LIGHT_SAMPLE_COUNT; sample = sample + 1u) {
      if (sample >= sampleCount) {
        break;
      }

      let samplePosition = areaLightSamplePosition(vector, sourceRadius, sample, sampleCount, lightIndex);
      let delta = samplePosition - position;
      let distanceSquared = max(dot(delta, delta), 0.08);
      let distance = sqrt(distanceSquared);
      let lightDirection = directionToLight(delta);
      let normalTerm = saturate(dot(normal, lightDirection));
      let safeRange = max(range, 0.001);
      let normalizedDistance = distance / safeRange;
      let rangeAttenuation = saturate(1.0 - normalizedDistance * normalizedDistance);

      if (
        normalTerm > 0.0 &&
        rangeAttenuation > 0.0 &&
        !rayOccluded(position + normal * SHADOW_EPSILON, lightDirection, distance - SHADOW_EPSILON * 2.0)
      ) {
        irradiance = irradiance + color * intensity / (4.0 * PI * distanceSquared) * rangeAttenuation * rangeAttenuation * normalTerm * 2.4;
      }
    }

    return irradiance / f32(sampleCount);
  }

  if (lightType == 1u) {
    let lightDirection = normalize(vector);
    let normalTerm = saturate(dot(normal, lightDirection));
    if (normalTerm <= 0.0 || rayOccluded(position + normal * SHADOW_EPSILON, lightDirection, params[16])) {
      return vec3<f32>(0.0);
    }

    return color * intensity * 0.000018 * normalTerm;
  }

  return vec3<f32>(0.0);
}

fn surfaceLighting(position: vec3<f32>, normal: vec3<f32>, lightCount: u32) -> vec3<f32> {
  var irradiance = vec3<f32>(0.0);
  for (var i = 0u; i < lightCount; i = i + 1u) {
    irradiance = irradiance + surfaceLightContribution(i, position, normal);
  }

  return irradiance;
}

fn sphereDirection(sampleIndex: u32, count: u32, seed: u32) -> vec3<f32> {
  let sample = f32(sampleIndex) + 0.5;
  let sampleCount = max(f32(count), 1.0);
  let z = 1.0 - 2.0 * sample / sampleCount;
  let radius = sqrt(max(0.0, 1.0 - z * z));
  let phi = GOLDEN_ANGLE * (sample + f32(seed & 1023u) * 0.037);

  return vec3<f32>(cos(phi) * radius, z, sin(phi) * radius);
}

fn hemisphereDirection(normal: vec3<f32>, sampleIndex: u32, bounce: u32, seed: u32, rayCount: u32) -> vec3<f32> {
  let sample = f32(sampleIndex) + 0.5;
  let sampleCount = max(f32(rayCount), 1.0);
  let cosTheta = sqrt(sample / sampleCount);
  let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  let phi = GOLDEN_ANGLE * (sample + f32((seed + bounce * 131u) & 2047u) * 0.011);
  let local = vec3<f32>(cos(phi) * sinTheta, cosTheta, sin(phi) * sinTheta);
  let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.y) > 0.92);
  let tangent = safeNormalize(cross(helper, normal), vec3<f32>(1.0, 0.0, 0.0));
  let bitangent = cross(normal, tangent);

  return safeNormalize(tangent * local.x + normal * local.y + bitangent * local.z, normal);
}

fn traceBounceContribution(
  probeIndex: u32,
  startPosition: vec3<f32>,
  firstDirection: vec3<f32>,
  lightCount: u32,
  bounces: u32,
  sampleIndex: u32,
  rayCount: u32,
) -> vec3<f32> {
  var origin = startPosition;
  var direction = firstDirection;
  var throughput = vec3<f32>(1.0 / f32(rayCount));
  var radiance = vec3<f32>(0.0);

  for (var bounce = 0u; bounce < bounces; bounce = bounce + 1u) {
    let hit = traceRay(origin + direction * BOUNCE_EPSILON, direction, BOUNCE_EPSILON, params[16]);
    if (!hit.hit) {
      break;
    }

    if (!hit.frontFacing) {
      break;
    }

    let hitPosition = origin + direction * hit.t;
    let directAtSurface = surfaceLighting(hitPosition + hit.normal * SHADOW_EPSILON, hit.normal, lightCount);
    let distanceAttenuation = 1.0 / (1.0 + hit.t * 0.08);
    let surfaceBounce = directAtSurface * hit.albedo * distanceAttenuation;

    radiance = radiance + throughput * surfaceBounce;

    let nextDirection = hemisphereDirection(hit.normal, sampleIndex, bounce, probeIndex, rayCount);
    let cosine = saturate(dot(hit.normal, nextDirection));
    throughput = throughput * hit.albedo * (BOUNCE_DECAY * max(0.15, cosine));

    if (length(throughput) < 0.0005) {
      break;
    }

    origin = hitPosition + hit.normal * BOUNCE_EPSILON;
    direction = nextDirection;
  }

  return radiance;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let localIndex = globalId.x;
  let rx = u32(params[0]);
  let ry = u32(params[1]);
  let rz = u32(params[2]);
  let probeCount = rx * ry * rz;
  let batchOffset = u32(params[17]);
  let batchCount = u32(params[18]);
  let index = batchOffset + localIndex;

  if (localIndex >= batchCount || index >= probeCount) {
    return;
  }

  let position = probePosition(index);
  let lightCount = u32(params[3]);
  let exposure = params[12];
  let bounces = u32(clamp(params[13], 0.0, 16.0));
  let bounceRayCount = min(max(u32(params[20]), 1u), MAX_BOUNCE_RAY_COUNT);
  var ambient = vec3<f32>(0.015, 0.017, 0.02);
  var directIrradiance = vec3<f32>(0.0);
  var bouncedIrradiance = vec3<f32>(0.0);
  var dominantDirection = vec3<f32>(0.0, 1.0, 0.0);
  var dominantIntensity = 0.0;

  for (var i = 0u; i < lightCount; i = i + 1u) {
    let contribution = lightContribution(i, position);
    directIrradiance = directIrradiance + contribution.irradiance;

    if (contribution.dominantIntensity > dominantIntensity) {
      dominantDirection = contribution.directionToLight;
      dominantIntensity = contribution.dominantIntensity;
    }
  }

  for (var sample = 0u; sample < MAX_BOUNCE_RAY_COUNT; sample = sample + 1u) {
    if (sample >= bounceRayCount) {
      break;
    }

    let direction = sphereDirection(sample, bounceRayCount, index);
    bouncedIrradiance = bouncedIrradiance + traceBounceContribution(index, position, direction, lightCount, bounces, sample, bounceRayCount);
  }

  ambient = ambient + directIrradiance + bouncedIrradiance;
  ambient = ambient * exposure;
  let outputBase = index * PROBE_STRIDE;
  outputData[outputBase] = ambient.r;
  outputData[outputBase + 1u] = ambient.g;
  outputData[outputBase + 2u] = ambient.b;
  outputData[outputBase + 3u] = 1.0;
  outputData[outputBase + 4u] = ambient.r * dominantDirection.x;
  outputData[outputBase + 5u] = ambient.g * dominantDirection.x;
  outputData[outputBase + 6u] = ambient.b * dominantDirection.x;
  outputData[outputBase + 7u] = 0.0;
  outputData[outputBase + 8u] = ambient.r * dominantDirection.y;
  outputData[outputBase + 9u] = ambient.g * dominantDirection.y;
  outputData[outputBase + 10u] = ambient.b * dominantDirection.y;
  outputData[outputBase + 11u] = 0.0;
  outputData[outputBase + 12u] = dominantDirection.x;
  outputData[outputBase + 13u] = dominantDirection.y;
  outputData[outputBase + 14u] = dominantDirection.z;
  outputData[outputBase + 15u] = dominantIntensity * exposure;
}
`
