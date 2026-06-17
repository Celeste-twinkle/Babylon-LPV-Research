import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

export const IRRADIANCE_VOLUME_STORAGE_KEY = 'babylon-lpv-research:sponza-irradiance-volume'
export const IRRADIANCE_VOLUME_BINARY_DB = 'babylon-lpv-research'
export const IRRADIANCE_VOLUME_BINARY_STORE = 'volume-assets'
export const IRRADIANCE_VOLUME_BINARY_KEY = 'latest-sponza.ivol'
export const IVOL_HEADER_BYTES = 96
export const IVOL_PROBE_STRIDE_FLOATS = 16

export type Vec3Tuple = [number, number, number]

export type IrradianceProbe = {
  ambient: Vec3Tuple
  dominantDirection: Vec3Tuple
  dominantIntensity: number
}

export type IrradianceVolumeData = {
  version: 1
  name: string
  sourceModel: string
  createdAt: string
  bounds: {
    min: Vec3Tuple
    max: Vec3Tuple
  }
  resolution: Vec3Tuple
  colorSpace: 'linear'
  probeLayout: 'x-fastest'
  probes: IrradianceProbe[]
}

export type IrradianceSample = {
  ambient: Color3
  dominantDirection: Vector3
  dominantIntensity: number
}

export type BinaryIrradianceVolume = {
  kind: 'binary'
  name: string
  buffer: ArrayBuffer
  payload: Float32Array
  bounds: {
    min: Vec3Tuple
    max: Vec3Tuple
  }
  resolution: Vec3Tuple
  probeStrideFloats: number
}

export const tupleToVector3 = (tuple: Vec3Tuple): Vector3 =>
  new Vector3(tuple[0], tuple[1], tuple[2])

export const vector3ToTuple = (vector: Vector3): Vec3Tuple => [
  roundForJson(vector.x),
  roundForJson(vector.y),
  roundForJson(vector.z),
]

export const tupleToColor3 = (tuple: Vec3Tuple): Color3 =>
  new Color3(tuple[0], tuple[1], tuple[2])

export const color3ToTuple = (color: Color3): Vec3Tuple => [
  roundForJson(color.r),
  roundForJson(color.g),
  roundForJson(color.b),
]

export const probeIndex = (
  x: number,
  y: number,
  z: number,
  resolution: Vec3Tuple,
): number => x + y * resolution[0] + z * resolution[0] * resolution[1]

export const getProbePosition = (
  volume: Pick<IrradianceVolumeData, 'bounds' | 'resolution'>,
  x: number,
  y: number,
  z: number,
): Vector3 => {
  const min = tupleToVector3(volume.bounds.min)
  const max = tupleToVector3(volume.bounds.max)
  const rx = Math.max(1, volume.resolution[0] - 1)
  const ry = Math.max(1, volume.resolution[1] - 1)
  const rz = Math.max(1, volume.resolution[2] - 1)

  return new Vector3(
    lerp(min.x, max.x, x / rx),
    lerp(min.y, max.y, y / ry),
    lerp(min.z, max.z, z / rz),
  )
}

export const sampleIrradianceVolume = (
  volume: IrradianceVolumeData,
  worldPosition: Vector3,
): IrradianceSample => {
  const min = tupleToVector3(volume.bounds.min)
  const max = tupleToVector3(volume.bounds.max)
  const resolution = volume.resolution
  const local = new Vector3(
    safeRatio(worldPosition.x - min.x, max.x - min.x) * (resolution[0] - 1),
    safeRatio(worldPosition.y - min.y, max.y - min.y) * (resolution[1] - 1),
    safeRatio(worldPosition.z - min.z, max.z - min.z) * (resolution[2] - 1),
  )

  const x0 = clampInt(Math.floor(local.x), 0, resolution[0] - 1)
  const y0 = clampInt(Math.floor(local.y), 0, resolution[1] - 1)
  const z0 = clampInt(Math.floor(local.z), 0, resolution[2] - 1)
  const x1 = clampInt(x0 + 1, 0, resolution[0] - 1)
  const y1 = clampInt(y0 + 1, 0, resolution[1] - 1)
  const z1 = clampInt(z0 + 1, 0, resolution[2] - 1)
  const tx = clamp01(local.x - x0)
  const ty = clamp01(local.y - y0)
  const tz = clamp01(local.z - z0)

  const c000 = readProbe(volume, x0, y0, z0)
  const c100 = readProbe(volume, x1, y0, z0)
  const c010 = readProbe(volume, x0, y1, z0)
  const c110 = readProbe(volume, x1, y1, z0)
  const c001 = readProbe(volume, x0, y0, z1)
  const c101 = readProbe(volume, x1, y0, z1)
  const c011 = readProbe(volume, x0, y1, z1)
  const c111 = readProbe(volume, x1, y1, z1)

  const ambient = lerpColor(
    lerpColor(
      lerpColor(c000.ambient, c100.ambient, tx),
      lerpColor(c010.ambient, c110.ambient, tx),
      ty,
    ),
    lerpColor(
      lerpColor(c001.ambient, c101.ambient, tx),
      lerpColor(c011.ambient, c111.ambient, tx),
      ty,
    ),
    tz,
  )

  const dominantDirection = lerpVector(
    lerpVector(
      lerpVector(c000.dominantDirection, c100.dominantDirection, tx),
      lerpVector(c010.dominantDirection, c110.dominantDirection, tx),
      ty,
    ),
    lerpVector(
      lerpVector(c001.dominantDirection, c101.dominantDirection, tx),
      lerpVector(c011.dominantDirection, c111.dominantDirection, tx),
      ty,
    ),
    tz,
  ).normalize()

  const dominantIntensity = lerp(
    lerp(
      lerp(c000.dominantIntensity, c100.dominantIntensity, tx),
      lerp(c010.dominantIntensity, c110.dominantIntensity, tx),
      ty,
    ),
    lerp(
      lerp(c001.dominantIntensity, c101.dominantIntensity, tx),
      lerp(c011.dominantIntensity, c111.dominantIntensity, tx),
      ty,
    ),
    tz,
  )

  return { ambient, dominantDirection, dominantIntensity }
}

export const sampleBinaryIrradianceVolume = (
  volume: BinaryIrradianceVolume,
  worldPosition: Vector3,
): IrradianceSample => {
  const min = tupleToVector3(volume.bounds.min)
  const max = tupleToVector3(volume.bounds.max)
  const resolution = volume.resolution
  const local = new Vector3(
    safeRatio(worldPosition.x - min.x, max.x - min.x) * (resolution[0] - 1),
    safeRatio(worldPosition.y - min.y, max.y - min.y) * (resolution[1] - 1),
    safeRatio(worldPosition.z - min.z, max.z - min.z) * (resolution[2] - 1),
  )

  const x0 = clampInt(Math.floor(local.x), 0, resolution[0] - 1)
  const y0 = clampInt(Math.floor(local.y), 0, resolution[1] - 1)
  const z0 = clampInt(Math.floor(local.z), 0, resolution[2] - 1)
  const x1 = clampInt(x0 + 1, 0, resolution[0] - 1)
  const y1 = clampInt(y0 + 1, 0, resolution[1] - 1)
  const z1 = clampInt(z0 + 1, 0, resolution[2] - 1)
  const tx = clamp01(local.x - x0)
  const ty = clamp01(local.y - y0)
  const tz = clamp01(local.z - z0)

  const c000 = readBinaryProbe(volume, x0, y0, z0)
  const c100 = readBinaryProbe(volume, x1, y0, z0)
  const c010 = readBinaryProbe(volume, x0, y1, z0)
  const c110 = readBinaryProbe(volume, x1, y1, z0)
  const c001 = readBinaryProbe(volume, x0, y0, z1)
  const c101 = readBinaryProbe(volume, x1, y0, z1)
  const c011 = readBinaryProbe(volume, x0, y1, z1)
  const c111 = readBinaryProbe(volume, x1, y1, z1)

  const ambient = lerpColor(
    lerpColor(
      lerpColor(c000.ambient, c100.ambient, tx),
      lerpColor(c010.ambient, c110.ambient, tx),
      ty,
    ),
    lerpColor(
      lerpColor(c001.ambient, c101.ambient, tx),
      lerpColor(c011.ambient, c111.ambient, tx),
      ty,
    ),
    tz,
  )

  const dominantDirection = lerpVector(
    lerpVector(
      lerpVector(c000.dominantDirection, c100.dominantDirection, tx),
      lerpVector(c010.dominantDirection, c110.dominantDirection, tx),
      ty,
    ),
    lerpVector(
      lerpVector(c001.dominantDirection, c101.dominantDirection, tx),
      lerpVector(c011.dominantDirection, c111.dominantDirection, tx),
      ty,
    ),
    tz,
  ).normalize()

  const dominantIntensity = lerp(
    lerp(
      lerp(c000.dominantIntensity, c100.dominantIntensity, tx),
      lerp(c010.dominantIntensity, c110.dominantIntensity, tx),
      ty,
    ),
    lerp(
      lerp(c001.dominantIntensity, c101.dominantIntensity, tx),
      lerp(c011.dominantIntensity, c111.dominantIntensity, tx),
      ty,
    ),
    tz,
  )

  return { ambient, dominantDirection, dominantIntensity }
}

export const createIvolBinary = (
  volume: Pick<IrradianceVolumeData, 'bounds' | 'resolution'>,
  payload: Float32Array,
): ArrayBuffer => {
  const expectedFloats =
    volume.resolution[0] *
    volume.resolution[1] *
    volume.resolution[2] *
    IVOL_PROBE_STRIDE_FLOATS

  if (payload.length !== expectedFloats) {
    throw new Error(`Invalid IVOL payload length. Expected ${expectedFloats}, got ${payload.length}.`)
  }

  const buffer = new ArrayBuffer(IVOL_HEADER_BYTES + payload.byteLength)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  bytes[0] = 0x49
  bytes[1] = 0x56
  bytes[2] = 0x4f
  bytes[3] = 0x4c
  view.setUint32(4, 1, true)
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
  view.setUint32(56, 0, true)
  new Float32Array(buffer, IVOL_HEADER_BYTES).set(payload)

  return buffer
}

export const parseIvolBinary = (buffer: ArrayBuffer): BinaryIrradianceVolume => {
  const view = new DataView(buffer)

  if (
    view.getUint8(0) !== 0x49 ||
    view.getUint8(1) !== 0x56 ||
    view.getUint8(2) !== 0x4f ||
    view.getUint8(3) !== 0x4c
  ) {
    throw new Error('Invalid IVOL magic.')
  }

  const version = view.getUint32(4, true)
  const payloadOffset = view.getUint32(8, true)
  const probeStrideFloats = view.getUint32(12, true)

  if (version !== 1) {
    throw new Error(`Unsupported IVOL version: ${version}.`)
  }

  if (payloadOffset % 4 !== 0 || probeStrideFloats !== IVOL_PROBE_STRIDE_FLOATS) {
    throw new Error('Unsupported IVOL layout.')
  }

  const resolution: Vec3Tuple = [
    view.getUint32(16, true),
    view.getUint32(20, true),
    view.getUint32(24, true),
  ]
  const bounds = {
    min: [
      view.getFloat32(28, true),
      view.getFloat32(32, true),
      view.getFloat32(36, true),
    ] as Vec3Tuple,
    max: [
      view.getFloat32(40, true),
      view.getFloat32(44, true),
      view.getFloat32(48, true),
    ] as Vec3Tuple,
  }
  const expectedFloats =
    resolution[0] * resolution[1] * resolution[2] * probeStrideFloats

  return {
    kind: 'binary',
    name: 'Sponza WebGPU IVOL',
    buffer,
    payload: new Float32Array(buffer, payloadOffset, expectedFloats),
    bounds,
    resolution,
    probeStrideFloats,
  }
}

export const createProceduralFallbackVolume = (
  bounds: IrradianceVolumeData['bounds'],
  resolution: Vec3Tuple = [10, 5, 10],
): IrradianceVolumeData => {
  const probes: IrradianceProbe[] = []
  const volume = {
    bounds,
    resolution,
  }

  for (let z = 0; z < resolution[2]; z += 1) {
    for (let y = 0; y < resolution[1]; y += 1) {
      for (let x = 0; x < resolution[0]; x += 1) {
        const position = getProbePosition(volume, x, y, z)
        const height = y / Math.max(1, resolution[1] - 1)
        const sideWarmth = clamp01((position.x - bounds.min[0]) / (bounds.max[0] - bounds.min[0]))
        const ambient = new Color3(
          0.06 + height * 0.18 + sideWarmth * 0.12,
          0.065 + height * 0.14,
          0.07 + (1 - sideWarmth) * 0.16,
        )

        probes.push({
          ambient: color3ToTuple(ambient),
          dominantDirection: vector3ToTuple(new Vector3(-0.45, 0.84, 0.3).normalize()),
          dominantIntensity: roundForJson(0.35 + height * 0.45),
        })
      }
    }
  }

  return {
    version: 1,
    name: 'Procedural fallback volume',
    sourceModel: 'Sponza glTF fallback',
    createdAt: new Date().toISOString(),
    bounds,
    resolution,
    colorSpace: 'linear',
    probeLayout: 'x-fastest',
    probes,
  }
}

export const validateVolumeData = (value: unknown): IrradianceVolumeData => {
  if (!value || typeof value !== 'object') {
    throw new Error('Volume JSON is not an object.')
  }

  const candidate = value as Partial<IrradianceVolumeData>
  if (candidate.version !== 1) {
    throw new Error('Unsupported IrradianceVolume version.')
  }

  if (!Array.isArray(candidate.resolution) || candidate.resolution.length !== 3) {
    throw new Error('Volume resolution is missing.')
  }

  const expectedProbeCount =
    candidate.resolution[0] * candidate.resolution[1] * candidate.resolution[2]

  if (!Array.isArray(candidate.probes) || candidate.probes.length !== expectedProbeCount) {
    throw new Error(`Volume probe count mismatch. Expected ${expectedProbeCount}.`)
  }

  return candidate as IrradianceVolumeData
}

export const volumeSummary = (volume: IrradianceVolumeData): string =>
  `${volume.resolution[0]} x ${volume.resolution[1]} x ${volume.resolution[2]} / ${volume.probes.length} probes`

export const binaryVolumeSummary = (volume: BinaryIrradianceVolume): string =>
  `${volume.resolution[0]} x ${volume.resolution[1]} x ${volume.resolution[2]} / ${volume.payload.length / volume.probeStrideFloats} probes`

const readProbe = (
  volume: IrradianceVolumeData,
  x: number,
  y: number,
  z: number,
): IrradianceSample => {
  const probe = volume.probes[probeIndex(x, y, z, volume.resolution)]

  return {
    ambient: tupleToColor3(probe.ambient),
    dominantDirection: tupleToVector3(probe.dominantDirection),
    dominantIntensity: probe.dominantIntensity,
  }
}

const readBinaryProbe = (
  volume: BinaryIrradianceVolume,
  x: number,
  y: number,
  z: number,
): IrradianceSample => {
  const base =
    probeIndex(x, y, z, volume.resolution) * volume.probeStrideFloats
  const payload = volume.payload

  return {
    ambient: new Color3(payload[base], payload[base + 1], payload[base + 2]),
    dominantDirection: new Vector3(payload[base + 12], payload[base + 13], payload[base + 14]),
    dominantIntensity: payload[base + 15],
  }
}

const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount

const lerpColor = (a: Color3, b: Color3, amount: number): Color3 =>
  new Color3(lerp(a.r, b.r, amount), lerp(a.g, b.g, amount), lerp(a.b, b.b, amount))

const lerpVector = (a: Vector3, b: Vector3, amount: number): Vector3 =>
  new Vector3(lerp(a.x, b.x, amount), lerp(a.y, b.y, amount), lerp(a.z, b.z, amount))

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const safeRatio = (value: number, size: number): number =>
  clamp01(size === 0 ? 0 : value / size)

const roundForJson = (value: number): number => Number(value.toFixed(5))
