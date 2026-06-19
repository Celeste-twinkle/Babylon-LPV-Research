import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import { Ray } from '@babylonjs/core/Culling/ray'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import type { BakeLightConfig } from './defaultBakeLights'
import type { Vec3Tuple } from './irradianceVolume'

export const SHADOW_MASK_HEADER_BYTES = 96
export const SHADOW_MASK_MAGIC = 'ISMK'
export const SHADOW_MASK_VERSION = 4
export const SHADOW_MASK_PLANE_COUNT = 6

export type StaticShadowMask = {
  kind: 'shadowmask'
  name: string
  buffer: ArrayBuffer
  payload: Float32Array
  lightPayload: Float32Array
  depthPayload: Float32Array
  bounds: {
    min: Vec3Tuple
    max: Vec3Tuple
  }
  width: number
  height: number
  planeCount: number
}

export type StaticShadowMaskBakeInput = {
  scene: Scene
  bounds: StaticShadowMask['bounds']
  geometry: AbstractMesh[]
  lights: BakeLightConfig[]
  resolution: number
  onProgress?: (percent: number, message: string) => void
}

const SHADOW_EPSILON = 0.035
const MIN_DISTANCE_SQUARED = 0.08
const MIN_SURFACE_NORMAL_ALIGNMENT = 0.18
const GOLDEN_ANGLE = 2.39996322973
const SHADOW_MASK_TRACE_RESOLUTION_CAP = 512
const SHADOW_MASK_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024

type ShadowMaskProjectionPlane = {
  name: string
  direction: Vector3
  uAxis: 'x' | 'z'
  vAxis: 'y' | 'z'
  fixedAxis: 'x' | 'y' | 'z'
  fixedSign: -1 | 1
}

const PROJECTION_PLANES: ShadowMaskProjectionPlane[] = [
  { name: '+Y floor/top faces', direction: Vector3.Down(), uAxis: 'x', vAxis: 'z', fixedAxis: 'y', fixedSign: 1 },
  { name: '-Y underside faces', direction: Vector3.Up(), uAxis: 'x', vAxis: 'z', fixedAxis: 'y', fixedSign: -1 },
  { name: '+X side faces', direction: Vector3.Left(), uAxis: 'z', vAxis: 'y', fixedAxis: 'x', fixedSign: 1 },
  { name: '-X side faces', direction: Vector3.Right(), uAxis: 'z', vAxis: 'y', fixedAxis: 'x', fixedSign: -1 },
  { name: '+Z side faces', direction: Vector3.Backward(), uAxis: 'x', vAxis: 'y', fixedAxis: 'z', fixedSign: 1 },
  { name: '-Z side faces', direction: Vector3.Forward(), uAxis: 'x', vAxis: 'y', fixedAxis: 'z', fixedSign: -1 },
]

export const bakeStaticShadowMask = async (
  input: StaticShadowMaskBakeInput,
): Promise<ArrayBuffer> => {
  const requestedResolution = clampInteger(input.resolution, 32, 4096)
  const resolution = getSafeOutputResolution(input.scene, requestedResolution)
  const traceResolution = Math.min(resolution, SHADOW_MASK_TRACE_RESOLUTION_CAP)
  const traceTexelCount = traceResolution * traceResolution * SHADOW_MASK_PLANE_COUNT
  const tracePayload = new Float32Array(traceTexelCount)
  const traceLightPayload = new Float32Array(traceTexelCount * 3)
  const traceDepthPayload = new Float32Array(traceTexelCount)
  const traceSurfaceMask = new Uint8Array(traceTexelCount)
  const geometry = new Set(input.geometry)
  const lights = input.lights.filter((light) => light.enabled && light.intensity > 0 && light.range > 0)
  const min = new Vector3(input.bounds.min[0], input.bounds.min[1], input.bounds.min[2])
  const max = new Vector3(input.bounds.max[0], input.bounds.max[1], input.bounds.max[2])
  const size = max.subtract(min)
  const projectionPad = Math.max(2, size.x, size.y, size.z)
  const rayLength = Math.max(4, projectionPad * 2 + Math.max(size.x, size.y, size.z))
  const report = (percent: number, message: string): void => {
    input.onProgress?.(percent, message)
  }

  traceDepthPayload.fill(-1)

  if (resolution !== requestedResolution) {
    report(
      0,
      `Requested ${requestedResolution} px shadowmask exceeds the current single-atlas budget; baking ${resolution} px instead.`,
    )
  }

  report(
    0,
    `Baking ${resolution} px static shadowmask from ${traceResolution} px ray-traced samples per plane.`,
  )

  for (let planeIndex = 0; planeIndex < PROJECTION_PLANES.length; planeIndex += 1) {
    const plane = PROJECTION_PLANES[planeIndex]
    const planeOffset = planeIndex * traceResolution * traceResolution

    for (let y = 0; y < traceResolution; y += 1) {
      const v = (y + 0.5) / traceResolution

      for (let x = 0; x < traceResolution; x += 1) {
        const u = (x + 0.5) / traceResolution
        const surface = pickProjectedSurface(input.scene, geometry, min, max, plane, u, v, projectionPad, rayLength)
        const targetIndex = planeOffset + x + y * traceResolution

        if (!surface || Vector3.Dot(surface.normal, plane.direction.scale(-1)) < MIN_SURFACE_NORMAL_ALIGNMENT || lights.length === 0) {
          tracePayload[targetIndex] = 1
          continue
        }

        traceSurfaceMask[targetIndex] = 1
        const lighting = estimateSurfaceLighting(input.scene, geometry, surface.position, surface.normal, lights)
        tracePayload[targetIndex] = lighting.shadow
        traceLightPayload[targetIndex * 3] = lighting.irradiance.r
        traceLightPayload[targetIndex * 3 + 1] = lighting.irradiance.g
        traceLightPayload[targetIndex * 3 + 2] = lighting.irradiance.b
        traceDepthPayload[targetIndex] = getNormalizedAxisDepth(surface.position, min, max, plane.fixedAxis)
      }

      if (y % 4 === 0 || y === traceResolution - 1) {
        const completedRows = planeIndex * traceResolution + y + 1
        const totalRows = traceResolution * PROJECTION_PLANES.length

        report(
          (completedRows / totalRows) * 96,
          `Ray tracing ${plane.name} shadowmask row ${y + 1} / ${traceResolution}.`,
        )
        await nextFrame()
      }
    }
  }

  report(97, 'Filtering static shadowmask and surface lightmap.')
  filterStaticSurfaceMaps(tracePayload, traceLightPayload, traceSurfaceMask, traceResolution, SHADOW_MASK_PLANE_COUNT)

  const { payload, lightPayload, depthPayload } = traceResolution === resolution
    ? { payload: tracePayload, lightPayload: traceLightPayload, depthPayload: traceDepthPayload }
    : resampleStaticSurfaceMaps(
      tracePayload,
      traceLightPayload,
      traceDepthPayload,
      traceSurfaceMask,
      traceResolution,
      resolution,
      SHADOW_MASK_PLANE_COUNT,
    )

  return createStaticShadowMaskBinary(input.bounds, resolution, resolution, payload, lightPayload, depthPayload, SHADOW_MASK_PLANE_COUNT)
}

export const createStaticShadowMaskBinary = (
  bounds: StaticShadowMask['bounds'],
  width: number,
  height: number,
  payload: Float32Array,
  lightPayload: Float32Array,
  depthPayload: Float32Array,
  planeCount = SHADOW_MASK_PLANE_COUNT,
): ArrayBuffer => {
  const expectedFloats = width * height * planeCount
  if (payload.length !== expectedFloats) {
    throw new Error(`Invalid shadowmask payload length. Expected ${expectedFloats}, got ${payload.length}.`)
  }
  if (lightPayload.length !== expectedFloats * 3) {
    throw new Error(`Invalid static lightmap payload length. Expected ${expectedFloats * 3}, got ${lightPayload.length}.`)
  }
  if (depthPayload.length !== expectedFloats) {
    throw new Error(`Invalid static surface depth payload length. Expected ${expectedFloats}, got ${depthPayload.length}.`)
  }

  const lightPayloadOffset = SHADOW_MASK_HEADER_BYTES + payload.byteLength
  const depthPayloadOffset = lightPayloadOffset + lightPayload.byteLength
  const buffer = new ArrayBuffer(depthPayloadOffset + depthPayload.byteLength)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  bytes[0] = 0x49
  bytes[1] = 0x53
  bytes[2] = 0x4d
  bytes[3] = 0x4b
  view.setUint32(4, SHADOW_MASK_VERSION, true)
  view.setUint32(8, SHADOW_MASK_HEADER_BYTES, true)
  view.setUint32(12, width, true)
  view.setUint32(16, height, true)
  view.setFloat32(20, bounds.min[0], true)
  view.setFloat32(24, bounds.min[1], true)
  view.setFloat32(28, bounds.min[2], true)
  view.setFloat32(32, bounds.max[0], true)
  view.setFloat32(36, bounds.max[1], true)
  view.setFloat32(40, bounds.max[2], true)
  view.setUint32(44, planeCount, true)
  view.setUint32(48, lightPayloadOffset, true)
  view.setUint32(52, 3, true)
  view.setUint32(56, depthPayloadOffset, true)
  view.setUint32(60, 1, true)
  new Float32Array(buffer, SHADOW_MASK_HEADER_BYTES).set(payload)
  new Float32Array(buffer, lightPayloadOffset).set(lightPayload)
  new Float32Array(buffer, depthPayloadOffset).set(depthPayload)

  return buffer
}

export const parseStaticShadowMaskBinary = (buffer: ArrayBuffer): StaticShadowMask => {
  if (buffer.byteLength < SHADOW_MASK_HEADER_BYTES) {
    throw new Error('Shadowmask binary is too small.')
  }

  const view = new DataView(buffer)

  if (!hasShadowMaskMagic(buffer)) {
    throw new Error('Invalid shadowmask magic.')
  }

  const version = view.getUint32(4, true)
  const payloadOffset = view.getUint32(8, true)
  const width = view.getUint32(12, true)
  const height = view.getUint32(16, true)
  const planeCount = view.getUint32(44, true)
  const lightPayloadOffset = view.getUint32(48, true)
  const lightChannelCount = view.getUint32(52, true)
  const depthPayloadOffset = view.getUint32(56, true)
  const depthChannelCount = view.getUint32(60, true)

  if (version !== SHADOW_MASK_VERSION) {
    throw new Error(`Unsupported shadowmask version: ${version}.`)
  }

  if (
    payloadOffset < SHADOW_MASK_HEADER_BYTES ||
    payloadOffset % 4 !== 0 ||
    lightPayloadOffset <= payloadOffset ||
    lightPayloadOffset % 4 !== 0 ||
    depthPayloadOffset <= lightPayloadOffset ||
    depthPayloadOffset % 4 !== 0 ||
    width < 1 ||
    height < 1 ||
    planeCount !== SHADOW_MASK_PLANE_COUNT ||
    lightChannelCount !== 3 ||
    depthChannelCount !== 1
  ) {
    throw new Error('Unsupported shadowmask layout.')
  }

  const payloadFloats = width * height * planeCount
  const lightPayloadFloats = payloadFloats * lightChannelCount
  const depthPayloadFloats = payloadFloats * depthChannelCount
  const payloadBytes = payloadFloats * Float32Array.BYTES_PER_ELEMENT
  const lightPayloadBytes = lightPayloadFloats * Float32Array.BYTES_PER_ELEMENT
  const depthPayloadBytes = depthPayloadFloats * Float32Array.BYTES_PER_ELEMENT

  if (
    !Number.isSafeInteger(payloadFloats) ||
    !Number.isSafeInteger(lightPayloadFloats) ||
    !Number.isSafeInteger(depthPayloadFloats) ||
    payloadOffset + payloadBytes > buffer.byteLength ||
    lightPayloadOffset + lightPayloadBytes > buffer.byteLength ||
    depthPayloadOffset + depthPayloadBytes > buffer.byteLength ||
    lightPayloadOffset < payloadOffset + payloadBytes ||
    depthPayloadOffset < lightPayloadOffset + lightPayloadBytes
  ) {
    throw new Error('Invalid shadowmask payload bounds.')
  }

  const bounds = {
    min: [
      view.getFloat32(20, true),
      view.getFloat32(24, true),
      view.getFloat32(28, true),
    ] as Vec3Tuple,
    max: [
      view.getFloat32(32, true),
      view.getFloat32(36, true),
      view.getFloat32(40, true),
    ] as Vec3Tuple,
  }

  return {
    kind: 'shadowmask',
    name: 'Static Shadowmask',
    buffer,
    payload: new Float32Array(buffer, payloadOffset, payloadFloats),
    lightPayload: new Float32Array(buffer, lightPayloadOffset, lightPayloadFloats),
    depthPayload: new Float32Array(buffer, depthPayloadOffset, depthPayloadFloats),
    bounds,
    width,
    height,
    planeCount,
  }
}

export const hasShadowMaskMagic = (buffer: ArrayBuffer): boolean => {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))

  return bytes[0] === 0x49 && bytes[1] === 0x53 && bytes[2] === 0x4d && bytes[3] === 0x4b
}

export const shadowMaskSummary = (mask: StaticShadowMask): string =>
  `${mask.width} x ${mask.height} x ${mask.planeCount} directional static shadowmask + RGB surface lightmap + surface depth`

export const shadowMaskQualitySummary = (mask: StaticShadowMask): string => {
  let shadowSum = 0
  let shadowedCount = 0
  let litTexelCount = 0
  let lightMax = 0

  for (let index = 0; index < mask.payload.length; index += 1) {
    const shadow = clamp01(mask.payload[index])
    const lightIndex = index * 3
    const light = luminance(
      mask.lightPayload[lightIndex] ?? 0,
      mask.lightPayload[lightIndex + 1] ?? 0,
      mask.lightPayload[lightIndex + 2] ?? 0,
    )

    shadowSum += shadow
    if (shadow < 0.98) {
      shadowedCount += 1
    }
    if (light > 0.00001) {
      litTexelCount += 1
    }
    lightMax = Math.max(lightMax, light)
  }

  const texelCount = Math.max(1, mask.payload.length)

  return [
    `shadow avg ${formatPercent(shadowSum / texelCount)}`,
    `shadowed texels ${formatPercent(shadowedCount / texelCount)}`,
    `lit texels ${formatPercent(litTexelCount / texelCount)}`,
    `light max ${lightMax.toFixed(lightMax < 1 ? 4 : 2)}`,
  ].join(', ')
}

const pickProjectedSurface = (
  scene: Scene,
  geometry: Set<AbstractMesh>,
  min: Vector3,
  max: Vector3,
  plane: ShadowMaskProjectionPlane,
  u: number,
  v: number,
  projectionPad: number,
  rayLength: number,
): { position: Vector3; normal: Vector3 } | null => {
  const origin = new Vector3(0, 0, 0)
  origin[plane.uAxis] = lerp(min[plane.uAxis], max[plane.uAxis], u)
  origin[plane.vAxis] = lerp(min[plane.vAxis], max[plane.vAxis], v)
  origin[plane.fixedAxis] = plane.fixedSign > 0
    ? max[plane.fixedAxis] + projectionPad
    : min[plane.fixedAxis] - projectionPad

  const ray = new Ray(origin, plane.direction, rayLength)
  const result = scene.pickWithRay(
    ray,
    (mesh) => geometry.has(mesh) && mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0,
    false,
  )

  if (!result?.hit || !result.pickedPoint) {
    return null
  }

  const normal = result.getNormal(true, true) ?? Vector3.Up()

  return {
    position: result.pickedPoint,
    normal: normal.normalize(),
  }
}

const estimateSurfaceLighting = (
  scene: Scene,
  geometry: Set<AbstractMesh>,
  position: Vector3,
  normal: Vector3,
  lights: BakeLightConfig[],
): { shadow: number; irradiance: { r: number; g: number; b: number } } => {
  let litEnergy = 0
  let unoccludedEnergy = 0
  const irradiance = { r: 0, g: 0, b: 0 }

  for (const light of lights) {
    const lightPosition = new Vector3(light.x, light.y, light.z)
    const lightColor = parseHexColor(light.color)
    const sourceRadius = Math.max(0, light.sourceRadius)
    const sampleCount = sourceRadius > 0.001 ? 4 : 1

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const samplePosition = sampleAreaLightPosition(lightPosition, sourceRadius, sample, sampleCount)
      const delta = samplePosition.subtract(position)
      const distanceSquared = Math.max(MIN_DISTANCE_SQUARED, delta.lengthSquared())
      const distance = Math.sqrt(distanceSquared)
      const directionToLight = delta.normalize()
      const normalTerm = clamp01(Vector3.Dot(normal, directionToLight))
      const normalizedDistance = distance / Math.max(0.001, light.range)
      const rangeAttenuation = clamp01(1 - normalizedDistance * normalizedDistance)
      const energy =
        (light.intensity / (4 * Math.PI * distanceSquared)) *
        rangeAttenuation *
        rangeAttenuation *
        normalTerm

      if (energy <= 0) {
        continue
      }

      unoccludedEnergy += energy
      if (!isOccluded(scene, geometry, position, normal, directionToLight, distance)) {
        litEnergy += energy
        irradiance.r += energy * lightColor.r
        irradiance.g += energy * lightColor.g
        irradiance.b += energy * lightColor.b
      }
    }
  }

  if (unoccludedEnergy <= 0.000001) {
    return { shadow: 1, irradiance }
  }

  return {
    shadow: clamp01(litEnergy / unoccludedEnergy),
    irradiance,
  }
}

const parseHexColor = (value: string): { r: number; g: number; b: number } => {
  const normalized = value.trim().replace(/^#/, '')
  const hex = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized.padEnd(6, 'f').slice(0, 6)
  const intValue = Number.parseInt(hex, 16)

  if (!Number.isFinite(intValue)) {
    return { r: 1, g: 1, b: 1 }
  }

  return {
    r: ((intValue >> 16) & 0xff) / 255,
    g: ((intValue >> 8) & 0xff) / 255,
    b: (intValue & 0xff) / 255,
  }
}

const isOccluded = (
  scene: Scene,
  geometry: Set<AbstractMesh>,
  position: Vector3,
  normal: Vector3,
  direction: Vector3,
  distance: number,
): boolean => {
  const origin = position.add(normal.scale(SHADOW_EPSILON))
  const ray = new Ray(origin, direction, Math.max(0.01, distance - SHADOW_EPSILON * 2))
  const result = scene.pickWithRay(
    ray,
    (mesh) => geometry.has(mesh) && mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0,
    true,
  )

  return result?.hit === true
}

const sampleAreaLightPosition = (
  center: Vector3,
  radius: number,
  sampleIndex: number,
  sampleCount: number,
): Vector3 => {
  if (radius <= 0.001 || sampleCount <= 1) {
    return center
  }

  const hasCenterSample = sampleCount % 2 === 1
  if (hasCenterSample && sampleIndex === 0) {
    return center
  }

  const pairSampleIndex = hasCenterSample ? sampleIndex - 1 : sampleIndex
  const pairIndex = Math.floor(pairSampleIndex / 2)
  const pairCount = Math.max(1, Math.floor(sampleCount / 2))
  const sample = pairIndex + 0.5
  const z = 1 - (2 * sample) / pairCount
  const radial = Math.sqrt(Math.max(0, 1 - z * z))
  const phi = GOLDEN_ANGLE * sample
  const sign = pairSampleIndex % 2 === 0 ? 1 : -1

  return center.add(new Vector3(
    Math.cos(phi) * radial * radius,
    z * radius,
    Math.sin(phi) * radial * radius,
  ).scale(sign))
}

const filterStaticSurfaceMaps = (
  shadowPayload: Float32Array,
  lightPayload: Float32Array,
  surfaceMask: Uint8Array,
  resolution: number,
  planeCount: number,
): void => {
  const sourceShadow = new Float32Array(shadowPayload)
  const sourceLight = new Float32Array(lightPayload)
  const neighborOffsets: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]

  for (let plane = 0; plane < planeCount; plane += 1) {
    const planeOffset = plane * resolution * resolution

    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const index = planeOffset + x + y * resolution

        if (surfaceMask[index] !== 1) {
          continue
        }

        const centerShadow = sourceShadow[index]
        const centerLightIndex = index * 3
        const centerLight = luminance(
          sourceLight[centerLightIndex],
          sourceLight[centerLightIndex + 1],
          sourceLight[centerLightIndex + 2],
        )
        let shadowSum = centerShadow
        let lightSumR = sourceLight[centerLightIndex]
        let lightSumG = sourceLight[centerLightIndex + 1]
        let lightSumB = sourceLight[centerLightIndex + 2]
        let weightSum = 1

        for (const [dx, dy] of neighborOffsets) {
          const nx = x + dx
          const ny = y + dy

          if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
            continue
          }

          const neighborIndex = planeOffset + nx + ny * resolution
          if (surfaceMask[neighborIndex] !== 1) {
            continue
          }

          const neighborLightIndex = neighborIndex * 3
          const shadowDelta = Math.abs(centerShadow - sourceShadow[neighborIndex])
          const neighborLight = luminance(
            sourceLight[neighborLightIndex],
            sourceLight[neighborLightIndex + 1],
            sourceLight[neighborLightIndex + 2],
          )
          const lightDelta = Math.abs(centerLight - neighborLight) / Math.max(0.0001, centerLight + neighborLight)
          const distanceWeight = dx !== 0 && dy !== 0 ? 0.18 : 0.28
          const edgeWeight = Math.max(0, 1 - shadowDelta * 3.2 - lightDelta * 1.6)
          const weight = distanceWeight * edgeWeight

          if (weight <= 0.0001) {
            continue
          }

          shadowSum += sourceShadow[neighborIndex] * weight
          lightSumR += sourceLight[neighborLightIndex] * weight
          lightSumG += sourceLight[neighborLightIndex + 1] * weight
          lightSumB += sourceLight[neighborLightIndex + 2] * weight
          weightSum += weight
        }

        shadowPayload[index] = clamp01(shadowSum / weightSum)
        lightPayload[centerLightIndex] = Math.max(0, lightSumR / weightSum)
        lightPayload[centerLightIndex + 1] = Math.max(0, lightSumG / weightSum)
        lightPayload[centerLightIndex + 2] = Math.max(0, lightSumB / weightSum)
      }
    }
  }
}

const resampleStaticSurfaceMaps = (
  shadowPayload: Float32Array,
  lightPayload: Float32Array,
  depthPayload: Float32Array,
  surfaceMask: Uint8Array,
  sourceResolution: number,
  targetResolution: number,
  planeCount: number,
): { payload: Float32Array; lightPayload: Float32Array; depthPayload: Float32Array } => {
  const targetTexelCount = targetResolution * targetResolution * planeCount
  const outputShadow = new Float32Array(targetTexelCount)
  const outputLight = new Float32Array(targetTexelCount * 3)
  const outputDepth = new Float32Array(targetTexelCount)

  outputDepth.fill(-1)

  for (let plane = 0; plane < planeCount; plane += 1) {
    const sourcePlaneOffset = plane * sourceResolution * sourceResolution
    const targetPlaneOffset = plane * targetResolution * targetResolution

    for (let y = 0; y < targetResolution; y += 1) {
      const sourceY = ((y + 0.5) / targetResolution) * sourceResolution - 0.5
      const y0 = clampInteger(Math.floor(sourceY), 0, sourceResolution - 1)
      const y1 = clampInteger(y0 + 1, 0, sourceResolution - 1)
      const ty = clamp01(sourceY - y0)

      for (let x = 0; x < targetResolution; x += 1) {
        const sourceX = ((x + 0.5) / targetResolution) * sourceResolution - 0.5
        const x0 = clampInteger(Math.floor(sourceX), 0, sourceResolution - 1)
        const x1 = clampInteger(x0 + 1, 0, sourceResolution - 1)
        const tx = clamp01(sourceX - x0)
        const targetIndex = targetPlaneOffset + x + y * targetResolution
        const i00 = sourcePlaneOffset + x0 + y0 * sourceResolution
        const i10 = sourcePlaneOffset + x1 + y0 * sourceResolution
        const i01 = sourcePlaneOffset + x0 + y1 * sourceResolution
        const i11 = sourcePlaneOffset + x1 + y1 * sourceResolution
        const nearestDepthIndex = sourcePlaneOffset + (tx < 0.5 ? x0 : x1) + (ty < 0.5 ? y0 : y1) * sourceResolution
        const selectedDepthIndex = getNearestSurfaceDepthIndex(surfaceMask, depthPayload, nearestDepthIndex, i00, i10, i01, i11)
        const selectedDepth = depthPayload[selectedDepthIndex] ?? -1

        if (selectedDepth < 0 || surfaceMask[selectedDepthIndex] !== 1) {
          outputShadow[targetIndex] = 1
          continue
        }

        const w00 = getBilateralResampleWeight(surfaceMask, depthPayload, i00, selectedDepth, (1 - tx) * (1 - ty))
        const w10 = getBilateralResampleWeight(surfaceMask, depthPayload, i10, selectedDepth, tx * (1 - ty))
        const w01 = getBilateralResampleWeight(surfaceMask, depthPayload, i01, selectedDepth, (1 - tx) * ty)
        const w11 = getBilateralResampleWeight(surfaceMask, depthPayload, i11, selectedDepth, tx * ty)
        const weightSum = w00 + w10 + w01 + w11

        if (weightSum <= 0.000001) {
          outputShadow[targetIndex] = clamp01(shadowPayload[selectedDepthIndex] ?? 1)
          outputDepth[targetIndex] = selectedDepth
          const selectedLightBase = selectedDepthIndex * 3
          const targetLightBase = targetIndex * 3
          outputLight[targetLightBase] = Math.max(0, lightPayload[selectedLightBase] ?? 0)
          outputLight[targetLightBase + 1] = Math.max(0, lightPayload[selectedLightBase + 1] ?? 0)
          outputLight[targetLightBase + 2] = Math.max(0, lightPayload[selectedLightBase + 2] ?? 0)
          continue
        }

        outputShadow[targetIndex] = clamp01(
          (
            shadowPayload[i00] * w00 +
            shadowPayload[i10] * w10 +
            shadowPayload[i01] * w01 +
            shadowPayload[i11] * w11
          ) / weightSum,
        )
        outputDepth[targetIndex] = (
          depthPayload[i00] * w00 +
          depthPayload[i10] * w10 +
          depthPayload[i01] * w01 +
          depthPayload[i11] * w11
        ) / weightSum
        const targetLightBase = targetIndex * 3
        for (let channel = 0; channel < 3; channel += 1) {
          outputLight[targetLightBase + channel] = Math.max(0, (
            lightPayload[i00 * 3 + channel] * w00 +
            lightPayload[i10 * 3 + channel] * w10 +
            lightPayload[i01 * 3 + channel] * w01 +
            lightPayload[i11 * 3 + channel] * w11
          ) / weightSum)
        }
      }
    }
  }

  return { payload: outputShadow, lightPayload: outputLight, depthPayload: outputDepth }
}

const getNearestSurfaceDepthIndex = (
  surfaceMask: Uint8Array,
  depthPayload: Float32Array,
  nearestIndex: number,
  i00: number,
  i10: number,
  i01: number,
  i11: number,
): number => {
  if (isValidSurfaceDepth(surfaceMask, depthPayload, nearestIndex)) {
    return nearestIndex
  }

  if (isValidSurfaceDepth(surfaceMask, depthPayload, i00)) return i00
  if (isValidSurfaceDepth(surfaceMask, depthPayload, i10)) return i10
  if (isValidSurfaceDepth(surfaceMask, depthPayload, i01)) return i01
  if (isValidSurfaceDepth(surfaceMask, depthPayload, i11)) return i11

  return nearestIndex
}

const isValidSurfaceDepth = (
  surfaceMask: Uint8Array,
  depthPayload: Float32Array,
  index: number,
): boolean => surfaceMask[index] === 1 && (depthPayload[index] ?? -1) >= 0

const getBilateralResampleWeight = (
  surfaceMask: Uint8Array,
  depthPayload: Float32Array,
  index: number,
  targetDepth: number,
  spatialWeight: number,
): number => {
  if (spatialWeight <= 0 || !isValidSurfaceDepth(surfaceMask, depthPayload, index) || targetDepth < 0) {
    return 0
  }

  const depthDelta = Math.abs(depthPayload[index] - targetDepth)
  const continuityWeight = 1 - smoothstep(0.0025, 0.018, depthDelta)

  return spatialWeight * continuityWeight
}

const getNormalizedAxisDepth = (
  position: Vector3,
  min: Vector3,
  max: Vector3,
  axis: 'x' | 'y' | 'z',
): number => clamp01((position[axis] - min[axis]) / Math.max(0.0001, max[axis] - min[axis]))

const getSafeOutputResolution = (scene: Scene, requestedResolution: number): number => {
  const caps = scene.getEngine().getCaps() as { maxTextureSize?: number }
  const maxTextureSize = caps.maxTextureSize ?? 16384
  const maxByTextureSize = Math.max(32, Math.floor(maxTextureSize / SHADOW_MASK_PLANE_COUNT))
  const maxByMemory = Math.max(
    32,
    Math.floor(Math.sqrt(SHADOW_MASK_MEMORY_BUDGET_BYTES / (SHADOW_MASK_PLANE_COUNT * 5 * Float32Array.BYTES_PER_ELEMENT))),
  )
  const maxResolution = Math.min(4096, maxByTextureSize, maxByMemory)

  return clampToResolutionTier(requestedResolution, maxResolution)
}

const clampToResolutionTier = (requestedResolution: number, maxResolution: number): number => {
  const tiers = [32, 64, 128, 256, 512, 1024, 2048, 4096]
  let selected = 32

  for (const tier of tiers) {
    if (tier <= requestedResolution && tier <= maxResolution) {
      selected = tier
    }
  }

  return selected
}

const luminance = (r: number, g: number, b: number): number =>
  r * 0.2126 + g * 0.7152 + b * 0.0722

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })

const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const amount = clamp01((value - edge0) / Math.max(0.000001, edge1 - edge0))

  return amount * amount * (3 - 2 * amount)
}

const clampInteger = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)))

const formatPercent = (value: number): string =>
  `${Math.round(clamp01(value) * 100)}%`
