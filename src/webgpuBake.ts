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
  accumulationSamples?: number
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
const MAX_DISPATCH_PROBE_SLICE_SIZE = 32
const MAX_DISPATCH_RAY_WORK_ESTIMATE = 8192
const PROBE_VISIBILITY_RAY_COUNT_ESTIMATE = 8
const PROBE_RELOCATION_RAY_COUNT_ESTIMATE = 12
const READBACK_CHUNK_BYTES = 16 * 1024 * 1024
const SHADER_READY_TIMEOUT_MS = 8000
const SUBMITTED_WORK_TIMEOUT_MS = 45000
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
  const rayWorkEstimate = estimateRayWorkPerProbe(input)
  const dispatchSliceSize = chooseDispatchProbeSliceSize(probeCount, rayWorkEstimate)
  const dispatchSliceCount = Math.ceil(probeCount / dispatchSliceSize)
  const accumulationSamples = clampInteger(input.accumulationSamples ?? 1, 1, 64)
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

    report(
      32,
      `Baking ${probeCount} probes with ${accumulationSamples} accumulation sample(s) across ${dispatchSliceCount} internal dispatch slice(s) of up to ${dispatchSliceSize} probes.`,
    )
    for (let sampleIndex = 0; sampleIndex < accumulationSamples; sampleIndex += 1) {
      for (let sliceIndex = 0; sliceIndex < dispatchSliceCount; sliceIndex += 1) {
        const sliceOffset = sliceIndex * dispatchSliceSize
        const currentSliceSize = Math.min(dispatchSliceSize, probeCount - sliceOffset)
        const completedUnits = sampleIndex * dispatchSliceCount + sliceIndex
        const totalUnits = accumulationSamples * dispatchSliceCount
        const progressStart = 32 + (completedUnits / totalUnits) * 54

        params[17] = sliceOffset
        params[18] = currentSliceSize
        params[21] = sampleIndex
        params[22] = accumulationSamples
        paramsBuffer.update(params)

        report(
          progressStart,
          `Queued accumulation sample ${sampleIndex + 1} / ${accumulationSamples}, dispatch slice ${sliceIndex + 1} / ${dispatchSliceCount}: probes ${sliceOffset + 1}-${sliceOffset + currentSliceSize}.`,
        )
        const popGpuErrorScope = pushGpuErrorScope(engine)
        if (!shader.dispatch(Math.ceil(currentSliceSize / 64))) {
          throw new Error(`WebGPU compute dispatch returned false for sample ${sampleIndex + 1}, dispatch slice ${sliceIndex + 1}.`)
        }
        await waitForSubmittedGpuWork(
          engine,
          SUBMITTED_WORK_TIMEOUT_MS,
          `accumulation sample ${sampleIndex + 1} / ${accumulationSamples}, dispatch slice ${sliceIndex + 1} / ${dispatchSliceCount}`,
        )
        await popGpuErrorScope(`accumulation sample ${sampleIndex + 1}, dispatch slice ${sliceIndex + 1}`)

        report(
          32 + ((completedUnits + 1) / totalUnits) * 54,
          `Completed accumulation sample ${sampleIndex + 1} / ${accumulationSamples}, dispatch slice ${sliceIndex + 1} / ${dispatchSliceCount}.`,
        )
        await sleep(0)
      }
    }

    report(88, 'Preparing chunked GPU readback.')
    let payload = await withTimeout(
      readStorageBufferInChunks(engine, outputBuffer, payloadBytes, report),
      READBACK_TIMEOUT_MS,
      'Timed out while reading the WebGPU irradiance payload.',
    )

    report(93, 'Denoising SH payload with visibility-aware neighbor filtering.')
    payload = denoiseIvolPayload(input.resolution, payload)

    report(94, 'Constraining SH coefficients and dominant light energy.')
    payload = constrainIvolPayloadSh(payload)

    report(95, 'Packing binary .ivol payload.')
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

const waitForSubmittedGpuWork = async (
  engine: WebGPUEngine,
  timeoutMs: number,
  context: string,
): Promise<void> => {
  const flushable = engine as FlushableWebGPUEngine

  flushable.flushFramebuffer?.(false)

  const device = flushable._device
  const queue = flushable._device?.queue
  const submittedWork = typeof queue?.onSubmittedWorkDone === 'function'
    ? queue.onSubmittedWorkDone()
    : sleep(0)

  if (!device) {
    await submittedWork

    return
  }

  await Promise.race([
    submittedWork,
    rejectOnDeviceLost(device, context),
    rejectAfterTimeout(timeoutMs, `Timed out while waiting for WebGPU work to finish (${context}).`),
  ])
}

const rejectAfterTimeout = async (timeoutMs: number, message: string): Promise<never> =>
  new Promise((_resolve, reject) => {
    window.setTimeout(() => {
      reject(new Error(`${message} (${timeoutMs}ms)`))
    }, timeoutMs)
  })

const rejectOnDeviceLost = async (device: GPUDevice, context: string): Promise<never> => {
  const info = await device.lost
  const reason = info.reason ? ` Reason: ${info.reason}.` : ''
  const message = info.message ? ` ${info.message}` : ''

  throw new Error(`WebGPU device was lost while baking ${context}.${reason}${message}`)
}

const pushGpuErrorScope = (engine: WebGPUEngine): ((context: string) => Promise<void>) => {
  const device = (engine as FlushableWebGPUEngine)._device

  if (!device) {
    return async () => {}
  }

  device.pushErrorScope('validation')
  device.pushErrorScope('out-of-memory')

  return async (context: string): Promise<void> => {
    const outOfMemoryError = await device.popErrorScope()
    const validationError = await device.popErrorScope()
    const error = outOfMemoryError ?? validationError

    if (error) {
      throw new Error(`WebGPU error during ${context}: ${error.message}`)
    }
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

const chooseDispatchProbeSliceSize = (probeCount: number, rayWorkEstimate: number): number => {
  const safeProbeCount = Math.max(1, probeCount)
  const safeWorkEstimate = Math.max(1, rayWorkEstimate)
  const maxByWork = Math.max(1, Math.floor(MAX_DISPATCH_RAY_WORK_ESTIMATE / safeWorkEstimate))

  return Math.max(1, Math.min(safeProbeCount, MAX_DISPATCH_PROBE_SLICE_SIZE, maxByWork))
}

const estimateRayWorkPerProbe = (input: WebGPUBakeInput): number => {
  const lightCount = Math.max(1, Math.min(MAX_LIGHTS, input.lights.length))
  const bounces = clampInteger(input.bounces, 0, 16)
  const areaSamples = clampInteger(input.areaSamples ?? 4, 1, 8)
  const bounceRayCount = clampInteger(input.bounceRayCount ?? 4, 1, 8)
  const directLightTraces = lightCount * areaSamples
  const surfaceLightTraces = lightCount * areaSamples
  const bounceTraces = bounceRayCount * bounces * (1 + surfaceLightTraces)
  const relocationAndVisibilityTraces =
    PROBE_RELOCATION_RAY_COUNT_ESTIMATE + PROBE_VISIBILITY_RAY_COUNT_ESTIMATE * 2

  return relocationAndVisibilityTraces + directLightTraces + bounceTraces
}

const clampInteger = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)))

const denoiseIvolPayload = (resolution: Vec3Tuple, payload: Float32Array): Float32Array => {
  const output = new Float32Array(payload)
  const [rx, ry, rz] = resolution
  const neighborOffsets: Vec3Tuple[] = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ]

  for (let z = 0; z < rz; z += 1) {
    for (let y = 0; y < ry; y += 1) {
      for (let x = 0; x < rx; x += 1) {
        const index = getPayloadProbeIndex(x, y, z, resolution)
        const base = index * IVOL_PROBE_STRIDE_FLOATS
        const centerVisibility = payload[base + 28]
        const centerProximity = payload[base + 29]
        const centerRelocation = payload[base + 33]
        const sums = new Float32Array(28)
        let weightSum = 1

        for (let channel = 0; channel < sums.length; channel += 1) {
          sums[channel] = payload[base + channel]
        }

        for (const [dx, dy, dz] of neighborOffsets) {
          const nx = x + dx
          const ny = y + dy
          const nz = z + dz

          if (nx < 0 || ny < 0 || nz < 0 || nx >= rx || ny >= ry || nz >= rz) {
            continue
          }

          const neighborBase = getPayloadProbeIndex(nx, ny, nz, resolution) * IVOL_PROBE_STRIDE_FLOATS
          const visibilityDelta = Math.abs(centerVisibility - payload[neighborBase + 28])
          const proximityDelta = Math.abs(centerProximity - payload[neighborBase + 29])
          const relocationDelta = Math.abs(centerRelocation - payload[neighborBase + 33])
          const edgeWeight = Math.max(0, 1 - visibilityDelta * 1.8 - proximityDelta * 1.4 - relocationDelta * 0.9)
          const neighborTrust = Math.max(0.08, payload[neighborBase + 28] * payload[neighborBase + 29])
          const weight = 0.28 * edgeWeight * neighborTrust

          if (weight <= 0.0001) {
            continue
          }

          for (let channel = 0; channel < sums.length; channel += 1) {
            sums[channel] += payload[neighborBase + channel] * weight
          }
          weightSum += weight
        }

        for (let channel = 0; channel < sums.length; channel += 1) {
          output[base + channel] = sums[channel] / weightSum
        }
      }
    }
  }

  return output
}

const constrainIvolPayloadSh = (payload: Float32Array): Float32Array => {
  const output = new Float32Array(payload)
  const probeCount = Math.floor(payload.length / IVOL_PROBE_STRIDE_FLOATS)
  const sampleDirections: Vec3Tuple[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]

  for (let probeIndex = 0; probeIndex < probeCount; probeIndex += 1) {
    const base = probeIndex * IVOL_PROBE_STRIDE_FLOATS

    for (let channel = 0; channel < 3; channel += 1) {
      const l0 = sanitizePositive(payload[base + channel])
      output[base + channel] = l0

      const l1Limit = l0 * 1.18 + 0.0001
      const l2Limit = l0 * 0.72 + 0.0001

      for (let coefficient = 1; coefficient <= 3; coefficient += 1) {
        const offset = base + coefficient * 3 + channel
        output[offset] = clampFinite(payload[offset], -l1Limit, l1Limit)
      }

      for (let coefficient = 4; coefficient <= 8; coefficient += 1) {
        const offset = base + coefficient * 3 + channel
        output[offset] = clampFinite(payload[offset], -l2Limit, l2Limit)
      }
    }

    let worstScale = 1
    for (const direction of sampleDirections) {
      const irradiance = evaluatePackedShDirection(output, base, direction)
      const ambientFloor = [
        output[base] * 0.025,
        output[base + 1] * 0.025,
        output[base + 2] * 0.025,
      ]

      for (let channel = 0; channel < 3; channel += 1) {
        if (irradiance[channel] < ambientFloor[channel]) {
          const dynamic = irradiance[channel] - output[base + channel] * 0.42
          if (dynamic < -0.0001) {
            const allowed = ambientFloor[channel] - output[base + channel] * 0.42
            worstScale = Math.min(worstScale, clamp01(allowed / dynamic))
          }
        }
      }
    }

    if (worstScale < 0.999) {
      for (let coefficient = 1; coefficient <= 8; coefficient += 1) {
        const offset = base + coefficient * 3
        output[offset] *= worstScale
        output[offset + 1] *= worstScale
        output[offset + 2] *= worstScale
      }
    }

    const ambientEnergy = luminance(output[base], output[base + 1], output[base + 2])
    output[base + 27] = clampFinite(payload[base + 27], 0, Math.max(0.0001, ambientEnergy * 4.5))
    output[base + 28] = clamp01Finite(payload[base + 28], 1)
    output[base + 29] = clamp01Finite(payload[base + 29], 1)
    output[base + 33] = clamp01Finite(payload[base + 33], 0)
    output[base + 34] = clamp01Finite(payload[base + 34], 1)
    output[base + 35] = clamp01Finite(payload[base + 35], 1)
  }

  return output
}

const evaluatePackedShDirection = (payload: Float32Array, base: number, direction: Vec3Tuple): Vec3Tuple => {
  const [x, y, z] = direction
  const result: Vec3Tuple = [0, 0, 0]

  for (let channel = 0; channel < 3; channel += 1) {
    const sh0 = payload[base + channel]
    const sh1 = payload[base + 3 + channel]
    const sh2 = payload[base + 6 + channel]
    const sh3 = payload[base + 9 + channel]
    const sh4 = payload[base + 12 + channel]
    const sh5 = payload[base + 15 + channel]
    const sh6 = payload[base + 18 + channel]
    const sh7 = payload[base + 21 + channel]
    const sh8 = payload[base + 24 + channel]
    const l1 = sh1 * x + sh2 * y + sh3 * z
    const l2 =
      sh4 * (x * y) +
      sh5 * (y * z) +
      sh6 * (3 * z * z - 1) +
      sh7 * (x * z) +
      sh8 * (x * x - y * y)

    result[channel] = sh0 * 0.42 + l1 * 0.72 + l2 * 0.32
  }

  return result
}

const sanitizePositive = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

const clampFinite = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

const clamp01Finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? clamp01(value) : fallback

const luminance = (r: number, g: number, b: number): number =>
  r * 0.2126 + g * 0.7152 + b * 0.0722

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const getPayloadProbeIndex = (
  x: number,
  y: number,
  z: number,
  resolution: Vec3Tuple,
): number => x + y * resolution[0] + z * resolution[0] * resolution[1]

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
  params[21] = 0
  params[22] = clampInteger(input.accumulationSamples ?? 1, 1, 64)

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
const PROBE_STRIDE : u32 = 36u;
const TRIANGLE_STRIDE : u32 = 16u;
const BVH_NODE_STRIDE : u32 = 12u;
const BVH_STACK_SIZE : u32 = 256u;
const MAX_BOUNCE_RAY_COUNT : u32 = 8u;
const MAX_AREA_LIGHT_SAMPLE_COUNT : u32 = 8u;
const PROBE_VISIBILITY_RAY_COUNT : u32 = 8u;
const PROBE_RELOCATION_RAY_COUNT : u32 = 12u;
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

struct RelocatedProbe {
  position: vec3<f32>,
  offset: vec3<f32>,
  strength: f32,
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
  var stack: array<u32, 256>;
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
      if (left >= 0) {
        if (stackSize >= BVH_STACK_SIZE) {
          return TriangleHit(true, false, minT, vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0));
        }
        stack[stackSize] = u32(left);
        stackSize = stackSize + 1u;
      }
      if (right >= 0) {
        if (stackSize >= BVH_STACK_SIZE) {
          return TriangleHit(true, false, minT, vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0));
        }
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

fn lightContribution(lightIndex: u32, position: vec3<f32>, sampleSeed: u32) -> LightContribution {
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

      let samplePosition = areaLightSamplePosition(vector, sourceRadius, sample, sampleCount, lightIndex + sampleSeed * 131u);
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

fn surfaceLightContribution(lightIndex: u32, position: vec3<f32>, normal: vec3<f32>, sampleSeed: u32) -> vec3<f32> {
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

      let samplePosition = areaLightSamplePosition(vector, sourceRadius, sample, sampleCount, lightIndex + sampleSeed * 173u);
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

fn surfaceLighting(position: vec3<f32>, normal: vec3<f32>, lightCount: u32, sampleSeed: u32) -> vec3<f32> {
  var irradiance = vec3<f32>(0.0);
  for (var i = 0u; i < lightCount; i = i + 1u) {
    irradiance = irradiance + surfaceLightContribution(i, position, normal, sampleSeed);
  }

  return irradiance;
}

fn shBasis4(direction: vec3<f32>) -> vec4<f32> {
  return vec4<f32>(
    1.0,
    direction.x,
    direction.y,
    direction.z,
  );
}

fn shBasis5(direction: vec3<f32>) -> vec4<f32> {
  return vec4<f32>(
    direction.x * direction.y,
    direction.y * direction.z,
    3.0 * direction.z * direction.z - 1.0,
    direction.x * direction.z,
  );
}

fn shBasis8(direction: vec3<f32>) -> f32 {
  return direction.x * direction.x - direction.y * direction.y;
}

fn probeVisibilityRadius() -> f32 {
  let rx = max(params[0] - 1.0, 1.0);
  let ry = max(params[1] - 1.0, 1.0);
  let rz = max(params[2] - 1.0, 1.0);
  let boundsSize = vec3<f32>(
    abs(params[8] - params[4]),
    abs(params[9] - params[5]),
    abs(params[10] - params[6]),
  );
  let cellSize = boundsSize / vec3<f32>(rx, ry, rz);
  let largestCell = max(max(cellSize.x, cellSize.y), cellSize.z);

  return clamp(largestCell * 1.65, 0.35, params[16]);
}

fn probeCellRadius() -> f32 {
  let rx = max(params[0] - 1.0, 1.0);
  let ry = max(params[1] - 1.0, 1.0);
  let rz = max(params[2] - 1.0, 1.0);
  let boundsSize = vec3<f32>(
    abs(params[8] - params[4]),
    abs(params[9] - params[5]),
    abs(params[10] - params[6]),
  );
  let cellSize = boundsSize / vec3<f32>(rx, ry, rz);

  return max(max(cellSize.x, cellSize.y), cellSize.z);
}

fn sphereDirection(sampleIndex: u32, count: u32, seed: u32) -> vec3<f32> {
  let sample = f32(sampleIndex) + 0.5;
  let sampleCount = max(f32(count), 1.0);
  let z = 1.0 - 2.0 * sample / sampleCount;
  let radius = sqrt(max(0.0, 1.0 - z * z));
  let phi = GOLDEN_ANGLE * (sample + f32(seed & 1023u) * 0.037);

  return vec3<f32>(cos(phi) * radius, z, sin(phi) * radius);
}

fn probeLocalVisibility(position: vec3<f32>, sampleSeed: u32) -> vec2<f32> {
  let triangleCount = u32(params[14]);
  let radius = probeVisibilityRadius();
  if (triangleCount == 0u || radius <= SHADOW_EPSILON * 2.0) {
    return vec2<f32>(1.0, 1.0);
  }

  var openness = 0.0;
  var nearestDistance = radius;

  for (var sample = 0u; sample < PROBE_VISIBILITY_RAY_COUNT; sample = sample + 1u) {
    let direction = sphereDirection(sample, PROBE_VISIBILITY_RAY_COUNT, sampleSeed + sample * 719u + 97u);
    let hit = traceRay(position + direction * SHADOW_EPSILON, direction, SHADOW_EPSILON, radius);

    if (hit.hit) {
      nearestDistance = min(nearestDistance, hit.t);
      openness = openness + smoothstep(radius * 0.16, radius, hit.t);
    } else {
      openness = openness + 1.0;
    }
  }

  let visibility = clamp(openness / f32(PROBE_VISIBILITY_RAY_COUNT), 0.0, 1.0);
  let normalizedNearest = clamp(nearestDistance / radius, 0.0, 1.0);

  return vec2<f32>(visibility, normalizedNearest);
}

fn relocateProbePosition(position: vec3<f32>, sampleSeed: u32) -> RelocatedProbe {
  let triangleCount = u32(params[14]);
  let cellRadius = probeCellRadius();
  let searchRadius = clamp(cellRadius * 0.82, 0.18, params[16]);
  if (triangleCount == 0u || searchRadius <= SHADOW_EPSILON * 2.0) {
    return RelocatedProbe(position, vec3<f32>(0.0), 0.0);
  }

  var pushDirection = vec3<f32>(0.0);
  var closeHitWeight = 0.0;

  for (var sample = 0u; sample < PROBE_RELOCATION_RAY_COUNT; sample = sample + 1u) {
    let direction = sphereDirection(sample, PROBE_RELOCATION_RAY_COUNT, sampleSeed + sample * 1049u + 211u);
    let hit = traceRay(position + direction * SHADOW_EPSILON, direction, SHADOW_EPSILON, searchRadius);

    if (hit.hit) {
      let closeness = 1.0 - clamp(hit.t / searchRadius, 0.0, 1.0);
      let weightedCloseness = closeness * closeness;
      pushDirection = pushDirection - direction * weightedCloseness;
      closeHitWeight = closeHitWeight + weightedCloseness;
    }
  }

  if (closeHitWeight <= 0.0001) {
    return RelocatedProbe(position, vec3<f32>(0.0), 0.0);
  }

  let relocationStrength = clamp(closeHitWeight / f32(PROBE_RELOCATION_RAY_COUNT) * 2.2, 0.0, 1.0);
  let safeDirection = safeNormalize(pushDirection, vec3<f32>(0.0, 1.0, 0.0));
  let maxOffset = cellRadius * 0.45;
  var offset = safeDirection * maxOffset * relocationStrength;
  var relocated = position + offset;

  let verification = probeLocalVisibility(relocated, sampleSeed + 1931u);
  if (verification.x < 0.08 && verification.y < 0.08) {
    offset = vec3<f32>(0.0);
    relocated = position;
  }

  return RelocatedProbe(relocated, offset, relocationStrength);
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
  sampleSeed: u32,
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
    let directAtSurface = surfaceLighting(hitPosition + hit.normal * SHADOW_EPSILON, hit.normal, lightCount, sampleSeed + bounce * 397u);
    let distanceAttenuation = 1.0 / (1.0 + hit.t * 0.08);
    let surfaceBounce = directAtSurface * hit.albedo * distanceAttenuation;

    radiance = radiance + throughput * surfaceBounce;

    let nextDirection = hemisphereDirection(hit.normal, sampleIndex, bounce, probeIndex + sampleSeed * 8191u, rayCount);
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
  let sliceOffset = u32(params[17]);
  let sliceCount = u32(params[18]);
  let index = sliceOffset + localIndex;

  if (localIndex >= sliceCount || index >= probeCount) {
    return;
  }

  let gridPosition = probePosition(index);
  let lightCount = u32(params[3]);
  let exposure = params[12];
  let bounces = u32(clamp(params[13], 0.0, 16.0));
  let bounceRayCount = min(max(u32(params[20]), 1u), MAX_BOUNCE_RAY_COUNT);
  let accumulationSampleIndex = u32(params[21]);
  let accumulationSampleCount = max(u32(params[22]), 1u);
  let accumulationWeight = 1.0 / f32(accumulationSampleCount);
  let sampleSeed = accumulationSampleIndex + index * 4099u;
  let relocationSeed = index * 4099u;
  let outputBase = index * PROBE_STRIDE;
  var relocatedProbe = RelocatedProbe(gridPosition, vec3<f32>(0.0), 0.0);
  if (accumulationSampleIndex == 0u) {
    relocatedProbe = relocateProbePosition(gridPosition, relocationSeed);
  } else {
    let storedOffset = vec3<f32>(
      outputData[outputBase + 30u],
      outputData[outputBase + 31u],
      outputData[outputBase + 32u],
    );
    relocatedProbe = RelocatedProbe(gridPosition + storedOffset, storedOffset, outputData[outputBase + 33u]);
  }
  let position = relocatedProbe.position;
  var ambient = vec3<f32>(0.015, 0.017, 0.02);
  var directIrradiance = vec3<f32>(0.0);
  var bouncedIrradiance = vec3<f32>(0.0);
  var sh0 = ambient;
  var sh1 = vec3<f32>(0.0);
  var sh2 = vec3<f32>(0.0);
  var sh3 = vec3<f32>(0.0);
  var sh4 = vec3<f32>(0.0);
  var sh5 = vec3<f32>(0.0);
  var sh6 = vec3<f32>(0.0);
  var sh7 = vec3<f32>(0.0);
  var sh8 = vec3<f32>(0.0);
  var dominantIntensity = 0.0;

  for (var i = 0u; i < lightCount; i = i + 1u) {
    let contribution = lightContribution(i, position, sampleSeed);
    let basisA = shBasis4(contribution.directionToLight);
    let basisB = shBasis5(contribution.directionToLight);
    directIrradiance = directIrradiance + contribution.irradiance;
    sh0 = sh0 + contribution.irradiance * basisA.x;
    sh1 = sh1 + contribution.irradiance * basisA.y;
    sh2 = sh2 + contribution.irradiance * basisA.z;
    sh3 = sh3 + contribution.irradiance * basisA.w;
    sh4 = sh4 + contribution.irradiance * basisB.x;
    sh5 = sh5 + contribution.irradiance * basisB.y;
    sh6 = sh6 + contribution.irradiance * basisB.z;
    sh7 = sh7 + contribution.irradiance * basisB.w;
    sh8 = sh8 + contribution.irradiance * shBasis8(contribution.directionToLight);

    if (contribution.dominantIntensity > dominantIntensity) {
      dominantIntensity = contribution.dominantIntensity;
    }
  }

  for (var sample = 0u; sample < MAX_BOUNCE_RAY_COUNT; sample = sample + 1u) {
    if (sample >= bounceRayCount) {
      break;
    }

    let direction = sphereDirection(sample, bounceRayCount, sampleSeed + sample * 101u);
    let bounceContribution = traceBounceContribution(index, position, direction, lightCount, bounces, sample, bounceRayCount, sampleSeed);
    let basisA = shBasis4(direction);
    let basisB = shBasis5(direction);
    bouncedIrradiance = bouncedIrradiance + bounceContribution;
    sh0 = sh0 + bounceContribution * basisA.x;
    sh1 = sh1 + bounceContribution * basisA.y;
    sh2 = sh2 + bounceContribution * basisA.z;
    sh3 = sh3 + bounceContribution * basisA.w;
    sh4 = sh4 + bounceContribution * basisB.x;
    sh5 = sh5 + bounceContribution * basisB.y;
    sh6 = sh6 + bounceContribution * basisB.z;
    sh7 = sh7 + bounceContribution * basisB.w;
    sh8 = sh8 + bounceContribution * shBasis8(direction);
  }

  ambient = (ambient + directIrradiance + bouncedIrradiance) * exposure;
  sh0 = sh0 * exposure;
  sh1 = sh1 * exposure;
  sh2 = sh2 * exposure;
  sh3 = sh3 * exposure;
  sh4 = sh4 * exposure;
  sh5 = sh5 * exposure;
  sh6 = sh6 * exposure;
  sh7 = sh7 * exposure;
  sh8 = sh8 * exposure;
  outputData[outputBase] = outputData[outputBase] + sh0.r * accumulationWeight;
  outputData[outputBase + 1u] = outputData[outputBase + 1u] + sh0.g * accumulationWeight;
  outputData[outputBase + 2u] = outputData[outputBase + 2u] + sh0.b * accumulationWeight;
  outputData[outputBase + 3u] = outputData[outputBase + 3u] + sh1.r * accumulationWeight;
  outputData[outputBase + 4u] = outputData[outputBase + 4u] + sh1.g * accumulationWeight;
  outputData[outputBase + 5u] = outputData[outputBase + 5u] + sh1.b * accumulationWeight;
  outputData[outputBase + 6u] = outputData[outputBase + 6u] + sh2.r * accumulationWeight;
  outputData[outputBase + 7u] = outputData[outputBase + 7u] + sh2.g * accumulationWeight;
  outputData[outputBase + 8u] = outputData[outputBase + 8u] + sh2.b * accumulationWeight;
  outputData[outputBase + 9u] = outputData[outputBase + 9u] + sh3.r * accumulationWeight;
  outputData[outputBase + 10u] = outputData[outputBase + 10u] + sh3.g * accumulationWeight;
  outputData[outputBase + 11u] = outputData[outputBase + 11u] + sh3.b * accumulationWeight;
  outputData[outputBase + 12u] = outputData[outputBase + 12u] + sh4.r * accumulationWeight;
  outputData[outputBase + 13u] = outputData[outputBase + 13u] + sh4.g * accumulationWeight;
  outputData[outputBase + 14u] = outputData[outputBase + 14u] + sh4.b * accumulationWeight;
  outputData[outputBase + 15u] = outputData[outputBase + 15u] + sh5.r * accumulationWeight;
  outputData[outputBase + 16u] = outputData[outputBase + 16u] + sh5.g * accumulationWeight;
  outputData[outputBase + 17u] = outputData[outputBase + 17u] + sh5.b * accumulationWeight;
  outputData[outputBase + 18u] = outputData[outputBase + 18u] + sh6.r * accumulationWeight;
  outputData[outputBase + 19u] = outputData[outputBase + 19u] + sh6.g * accumulationWeight;
  outputData[outputBase + 20u] = outputData[outputBase + 20u] + sh6.b * accumulationWeight;
  outputData[outputBase + 21u] = outputData[outputBase + 21u] + sh7.r * accumulationWeight;
  outputData[outputBase + 22u] = outputData[outputBase + 22u] + sh7.g * accumulationWeight;
  outputData[outputBase + 23u] = outputData[outputBase + 23u] + sh7.b * accumulationWeight;
  outputData[outputBase + 24u] = outputData[outputBase + 24u] + sh8.r * accumulationWeight;
  outputData[outputBase + 25u] = outputData[outputBase + 25u] + sh8.g * accumulationWeight;
  outputData[outputBase + 26u] = outputData[outputBase + 26u] + sh8.b * accumulationWeight;
  outputData[outputBase + 27u] = outputData[outputBase + 27u] + dominantIntensity * exposure * accumulationWeight;
  if (accumulationSampleIndex == 0u) {
    let localVisibility = probeLocalVisibility(position, relocationSeed);
    outputData[outputBase + 28u] = localVisibility.x;
    outputData[outputBase + 29u] = localVisibility.y;
    outputData[outputBase + 30u] = relocatedProbe.offset.x;
    outputData[outputBase + 31u] = relocatedProbe.offset.y;
    outputData[outputBase + 32u] = relocatedProbe.offset.z;
    outputData[outputBase + 33u] = relocatedProbe.strength;
    outputData[outputBase + 34u] = 1.0;
    outputData[outputBase + 35u] = 1.0;
  }
}
`
