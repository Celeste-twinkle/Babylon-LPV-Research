import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

export const IVOL_HEADER_BYTES = 96
export const IVOL_BINARY_VERSION = 1
export const IVOL_PROBE_STRIDE_FLOATS = 12

export type Vec3Tuple = [number, number, number]

export type IrradianceVolumeGrid = {
  bounds: {
    min: Vec3Tuple
    max: Vec3Tuple
  }
  resolution: Vec3Tuple
}

export type IrradianceSample = {
  ambient: Color3
  dominantDirection: Vector3
  dominantIntensity: number
}

export type BinaryIrradianceVolume = IrradianceVolumeGrid & {
  kind: 'binary'
  version: number
  name: string
  buffer: ArrayBuffer
  payload: Float32Array
  probeStrideFloats: number
}

export const tupleToVector3 = (tuple: Vec3Tuple): Vector3 =>
  new Vector3(tuple[0], tuple[1], tuple[2])

export const vector3ToTuple = (vector: Vector3): Vec3Tuple => [
  roundForStorage(vector.x),
  roundForStorage(vector.y),
  roundForStorage(vector.z),
]

export const probeIndex = (
  x: number,
  y: number,
  z: number,
  resolution: Vec3Tuple,
): number => x + y * resolution[0] + z * resolution[0] * resolution[1]

export const getProbePosition = (
  volume: IrradianceVolumeGrid,
  x: number,
  y: number,
  z: number,
): Vector3 => {
  const min = tupleToVector3(volume.bounds.min)
  const max = tupleToVector3(volume.bounds.max)
  const rx = Math.max(1, volume.resolution[0])
  const ry = Math.max(1, volume.resolution[1])
  const rz = Math.max(1, volume.resolution[2])

  return new Vector3(
    lerp(min.x, max.x, (x + 0.5) / rx),
    lerp(min.y, max.y, (y + 0.5) / ry),
    lerp(min.z, max.z, (z + 0.5) / rz),
  )
}

export const sampleBinaryIrradianceVolume = (
  volume: BinaryIrradianceVolume,
  worldPosition: Vector3,
): IrradianceSample => {
  const resolution = volume.resolution
  const localX = volumeAxisCoordinate(worldPosition.x, volume.bounds.min[0], volume.bounds.max[0], resolution[0])
  const localY = volumeAxisCoordinate(worldPosition.y, volume.bounds.min[1], volume.bounds.max[1], resolution[1])
  const localZ = volumeAxisCoordinate(worldPosition.z, volume.bounds.min[2], volume.bounds.max[2], resolution[2])
  const x0 = Math.floor(localX)
  const y0 = Math.floor(localY)
  const z0 = Math.floor(localZ)
  const x1 = Math.min(x0 + 1, resolution[0] - 1)
  const y1 = Math.min(y0 + 1, resolution[1] - 1)
  const z1 = Math.min(z0 + 1, resolution[2] - 1)
  const tx = localX - x0
  const ty = localY - y0
  const tz = localZ - z0
  const coefficients = new Float32Array(IVOL_PROBE_STRIDE_FLOATS)

  for (let coefficient = 0; coefficient < IVOL_PROBE_STRIDE_FLOATS; coefficient += 1) {
    const c000 = readCoefficient(volume, x0, y0, z0, coefficient)
    const c100 = readCoefficient(volume, x1, y0, z0, coefficient)
    const c010 = readCoefficient(volume, x0, y1, z0, coefficient)
    const c110 = readCoefficient(volume, x1, y1, z0, coefficient)
    const c001 = readCoefficient(volume, x0, y0, z1, coefficient)
    const c101 = readCoefficient(volume, x1, y0, z1, coefficient)
    const c011 = readCoefficient(volume, x0, y1, z1, coefficient)
    const c111 = readCoefficient(volume, x1, y1, z1, coefficient)
    const lower = lerp(lerp(c000, c100, tx), lerp(c010, c110, tx), ty)
    const upper = lerp(lerp(c001, c101, tx), lerp(c011, c111, tx), ty)
    coefficients[coefficient] = lerp(lower, upper, tz)
  }

  const dominantDirection = new Vector3(
    coefficients[3] + coefficients[4] + coefficients[5],
    coefficients[6] + coefficients[7] + coefficients[8],
    coefficients[9] + coefficients[10] + coefficients[11],
  )
  const dominantIntensity = dominantDirection.length()

  return {
    ambient: new Color3(coefficients[0], coefficients[1], coefficients[2]),
    dominantDirection: dominantIntensity > 0.000001
      ? dominantDirection.scale(1 / dominantIntensity)
      : new Vector3(0, 1, 0),
    dominantIntensity,
  }
}

export const createIvolBinary = (
  volume: IrradianceVolumeGrid,
  payload: Float32Array,
): ArrayBuffer => {
  validateGrid(volume)
  const expectedFloats = probeCount(volume.resolution) * IVOL_PROBE_STRIDE_FLOATS

  if (payload.length !== expectedFloats) {
    throw new Error(`Invalid IVOL payload length. Expected ${expectedFloats}, got ${payload.length}.`)
  }

  const buffer = new ArrayBuffer(IVOL_HEADER_BYTES + payload.byteLength)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  bytes.set([0x49, 0x56, 0x4f, 0x4c])
  view.setUint32(4, IVOL_BINARY_VERSION, true)
  view.setUint32(8, IVOL_HEADER_BYTES, true)
  view.setUint32(12, IVOL_PROBE_STRIDE_FLOATS, true)
  view.setUint32(16, volume.resolution[0], true)
  view.setUint32(20, volume.resolution[1], true)
  view.setUint32(24, volume.resolution[2], true)
  view.setFloat32(28, volume.bounds.min[0], true)
  view.setFloat32(32, volume.bounds.min[1], true)
  view.setFloat32(36, volume.bounds.min[2], true)
  view.setFloat32(40, volume.bounds.max[0], true)
  view.setFloat32(44, volume.bounds.max[1], true)
  view.setFloat32(48, volume.bounds.max[2], true)
  view.setUint32(52, 1, true)
  new Float32Array(buffer, IVOL_HEADER_BYTES).set(payload)

  return buffer
}

export const parseIvolBinary = (buffer: ArrayBuffer): BinaryIrradianceVolume => {
  if (buffer.byteLength < IVOL_HEADER_BYTES) {
    throw new Error('IVOL binary is too small.')
  }

  const bytes = new Uint8Array(buffer, 0, 4)
  if (bytes[0] !== 0x49 || bytes[1] !== 0x56 || bytes[2] !== 0x4f || bytes[3] !== 0x4c) {
    throw new Error('Invalid IVOL magic.')
  }

  const view = new DataView(buffer)
  const version = view.getUint32(4, true)
  const payloadOffset = view.getUint32(8, true)
  const probeStrideFloats = view.getUint32(12, true)
  if (version !== IVOL_BINARY_VERSION) {
    throw new Error(`Unsupported IVOL version: ${version}.`)
  }
  if (payloadOffset !== IVOL_HEADER_BYTES || probeStrideFloats !== IVOL_PROBE_STRIDE_FLOATS) {
    throw new Error('Unsupported IVOL layout.')
  }

  const resolution: Vec3Tuple = [
    view.getUint32(16, true),
    view.getUint32(20, true),
    view.getUint32(24, true),
  ]
  const bounds = {
    min: [view.getFloat32(28, true), view.getFloat32(32, true), view.getFloat32(36, true)] as Vec3Tuple,
    max: [view.getFloat32(40, true), view.getFloat32(44, true), view.getFloat32(48, true)] as Vec3Tuple,
  }
  const grid: IrradianceVolumeGrid = { bounds, resolution }
  validateGrid(grid)
  const expectedFloats = probeCount(resolution) * probeStrideFloats
  const expectedBytes = payloadOffset + expectedFloats * Float32Array.BYTES_PER_ELEMENT
  if (!Number.isSafeInteger(expectedFloats) || expectedBytes !== buffer.byteLength) {
    throw new Error(`Invalid IVOL payload length. Expected ${expectedBytes} bytes, got ${buffer.byteLength}.`)
  }

  return {
    kind: 'binary',
    version,
    name: `L1 irradiance volume ${resolution.join('x')}`,
    buffer,
    payload: new Float32Array(buffer, payloadOffset, expectedFloats),
    bounds,
    resolution,
    probeStrideFloats,
  }
}

export const binaryVolumeSummary = (volume: BinaryIrradianceVolume): string =>
  `${volume.resolution.join(' x ')} / ${probeCount(volume.resolution)} probes / L1 SH`

export const binaryVolumeQualitySummary = (volume: BinaryIrradianceVolume): string => {
  const count = probeCount(volume.resolution)
  let ambientMin = Number.POSITIVE_INFINITY
  let ambientMax = 0
  let directionalitySum = 0

  for (let index = 0; index < count; index += 1) {
    const base = index * volume.probeStrideFloats
    const ambient = luminance(volume.payload[base], volume.payload[base + 1], volume.payload[base + 2])
    const directional = Math.hypot(
      luminance(volume.payload[base + 3], volume.payload[base + 4], volume.payload[base + 5]),
      luminance(volume.payload[base + 6], volume.payload[base + 7], volume.payload[base + 8]),
      luminance(volume.payload[base + 9], volume.payload[base + 10], volume.payload[base + 11]),
    )
    ambientMin = Math.min(ambientMin, ambient)
    ambientMax = Math.max(ambientMax, ambient)
    directionalitySum += directional / Math.max(ambient, 0.0001)
  }

  return [
    `quality: ambient ${formatCompact(ambientMin)}-${formatCompact(ambientMax)}`,
    `L1 directionality avg ${Math.round(clamp01(directionalitySum / count) * 100)}%`,
  ].join(', ')
}

const validateGrid = (volume: IrradianceVolumeGrid): void => {
  if (volume.resolution.some((axis) => !Number.isInteger(axis) || axis < 2 || axis > 2048)) {
    throw new Error(`Invalid IVOL resolution: ${volume.resolution.join(' x ')}.`)
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const min = volume.bounds.min[axis]
    const max = volume.bounds.max[axis]
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      throw new Error(`Invalid IVOL bounds on axis ${axis}.`)
    }
  }
}

const probeCount = (resolution: Vec3Tuple): number =>
  resolution[0] * resolution[1] * resolution[2]

const readCoefficient = (
  volume: BinaryIrradianceVolume,
  x: number,
  y: number,
  z: number,
  coefficient: number,
): number => volume.payload[
  probeIndex(x, y, z, volume.resolution) * volume.probeStrideFloats + coefficient
]

const volumeAxisCoordinate = (value: number, min: number, max: number, resolution: number): number =>
  Math.min(
    resolution - 1,
    Math.max(0, clamp01((value - min) / (max - min)) * resolution - 0.5),
  )

const luminance = (r: number, g: number, b: number): number =>
  r * 0.2126 + g * 0.7152 + b * 0.0722

const formatCompact = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(value < 1 ? 4 : 2) : 'n/a'

const roundForStorage = (value: number): number => Number(value.toFixed(6))

const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
