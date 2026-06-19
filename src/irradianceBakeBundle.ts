import type { BinaryIrradianceVolume } from './irradianceVolume'
import { binaryVolumeQualitySummary, binaryVolumeSummary, parseIvolBinary } from './irradianceVolume'
import type { StaticShadowMask } from './staticShadowMask'
import { parseStaticShadowMaskBinary, shadowMaskQualitySummary, shadowMaskSummary } from './staticShadowMask'

export const IRRADIANCE_BAKE_BUNDLE_MAGIC = 'IVPK'
export const IRRADIANCE_BAKE_BUNDLE_EXTENSION = '.ivpack'

const IVPK_HEADER_BYTES = 16
const IVPK_CHUNK_ENTRY_BYTES = 16
const IVPK_VERSION = 1

const CHUNK_BASE_IVOL = fourCc('BASE')
const CHUNK_DETAIL_IVOL = fourCc('DTIL')
const CHUNK_SHADOW_MASK = fourCc('SHDW')

export type IrradianceBakeBundle = {
  kind: 'bundle'
  buffer: ArrayBuffer
  baseVolume: BinaryIrradianceVolume
  detailVolume: BinaryIrradianceVolume | null
  shadowMask: StaticShadowMask | null
}

type BundleChunkInput = {
  type: number
  buffer: ArrayBuffer
}

type BundleChunk = {
  type: number
  offset: number
  byteLength: number
}

export const createIrradianceBakeBundle = (
  baseIvol: ArrayBuffer,
  detailIvol: ArrayBuffer | null,
  shadowMask: ArrayBuffer | null,
): ArrayBuffer => {
  const chunks: BundleChunkInput[] = [{ type: CHUNK_BASE_IVOL, buffer: baseIvol }]

  if (detailIvol) {
    chunks.push({ type: CHUNK_DETAIL_IVOL, buffer: detailIvol })
  }
  if (shadowMask) {
    chunks.push({ type: CHUNK_SHADOW_MASK, buffer: shadowMask })
  }

  const tableBytes = chunks.length * IVPK_CHUNK_ENTRY_BYTES
  let writeOffset = align4(IVPK_HEADER_BYTES + tableBytes)
  const chunkTable: BundleChunk[] = []

  for (const chunk of chunks) {
    writeOffset = align4(writeOffset)
    chunkTable.push({
      type: chunk.type,
      offset: writeOffset,
      byteLength: chunk.buffer.byteLength,
    })
    writeOffset += chunk.buffer.byteLength
  }

  const output = new ArrayBuffer(align4(writeOffset))
  const bytes = new Uint8Array(output)
  const view = new DataView(output)

  bytes[0] = 0x49
  bytes[1] = 0x56
  bytes[2] = 0x50
  bytes[3] = 0x4b
  view.setUint32(4, IVPK_VERSION, true)
  view.setUint32(8, chunks.length, true)
  view.setUint32(12, IVPK_HEADER_BYTES, true)

  for (let index = 0; index < chunkTable.length; index += 1) {
    const entryOffset = IVPK_HEADER_BYTES + index * IVPK_CHUNK_ENTRY_BYTES
    const chunk = chunkTable[index]

    view.setUint32(entryOffset, chunk.type, true)
    view.setUint32(entryOffset + 4, chunk.offset, true)
    view.setUint32(entryOffset + 8, chunk.byteLength, true)
    view.setUint32(entryOffset + 12, 0, true)
    bytes.set(new Uint8Array(chunks[index].buffer), chunk.offset)
  }

  return output
}

export const parseIrradianceBakeBundle = (buffer: ArrayBuffer): IrradianceBakeBundle => {
  if (buffer.byteLength < IVPK_HEADER_BYTES) {
    throw new Error('Irradiance bake bundle is too small.')
  }

  if (!hasIrradianceBakeBundleMagic(buffer)) {
    throw new Error('Invalid irradiance bake bundle magic.')
  }

  const view = new DataView(buffer)
  const version = view.getUint32(4, true)
  const chunkCount = view.getUint32(8, true)
  const tableOffset = view.getUint32(12, true)
  const tableByteLength = chunkCount * IVPK_CHUNK_ENTRY_BYTES
  const tableEnd = tableOffset + tableByteLength

  if (version !== IVPK_VERSION) {
    throw new Error(`Unsupported irradiance bake bundle version: ${version}.`)
  }

  if (
    chunkCount < 1 ||
    tableOffset < IVPK_HEADER_BYTES ||
    tableByteLength / IVPK_CHUNK_ENTRY_BYTES !== chunkCount ||
    tableEnd > buffer.byteLength
  ) {
    throw new Error('Invalid irradiance bake bundle chunk table.')
  }

  const chunks = new Map<number, ArrayBuffer>()
  for (let index = 0; index < chunkCount; index += 1) {
    const entryOffset = tableOffset + index * IVPK_CHUNK_ENTRY_BYTES
    const type = view.getUint32(entryOffset, true)
    const offset = view.getUint32(entryOffset + 4, true)
    const byteLength = view.getUint32(entryOffset + 8, true)
    const end = offset + byteLength

    if (
      offset < tableEnd ||
      offset % 4 !== 0 ||
      byteLength < 1 ||
      end < offset ||
      end > buffer.byteLength
    ) {
      throw new Error(`Invalid irradiance bake bundle chunk ${index}.`)
    }

    chunks.set(type, buffer.slice(offset, end))
  }

  const baseIvol = chunks.get(CHUNK_BASE_IVOL)
  if (!baseIvol) {
    throw new Error('Irradiance bake bundle is missing its BASE IVOL chunk.')
  }

  const detailIvol = chunks.get(CHUNK_DETAIL_IVOL)
  const shadowMask = chunks.get(CHUNK_SHADOW_MASK)

  return {
    kind: 'bundle',
    buffer,
    baseVolume: parseIvolBinary(baseIvol),
    detailVolume: detailIvol ? parseIvolBinary(detailIvol) : null,
    shadowMask: shadowMask ? parseStaticShadowMaskBinary(shadowMask) : null,
  }
}

export const hasIrradianceBakeBundleMagic = (buffer: ArrayBuffer): boolean => {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))

  return bytes[0] === 0x49 && bytes[1] === 0x56 && bytes[2] === 0x50 && bytes[3] === 0x4b
}

export const irradianceBakeBundleSummary = (bundle: IrradianceBakeBundle): string => {
  const parts = [`base ${binaryVolumeSummary(bundle.baseVolume)}`]

  if (bundle.detailVolume) {
    parts.push(`detail ${binaryVolumeSummary(bundle.detailVolume)}`)
  }
  if (bundle.shadowMask) {
    parts.push(shadowMaskSummary(bundle.shadowMask))
  }

  return parts.join(' / ')
}

export const irradianceBakeBundleQualitySummary = (bundle: IrradianceBakeBundle): string => {
  const parts = [`base ${binaryVolumeQualitySummary(bundle.baseVolume)}`]

  if (bundle.detailVolume) {
    parts.push(`detail ${binaryVolumeQualitySummary(bundle.detailVolume)}`)
  }
  if (bundle.shadowMask) {
    parts.push(`static ${shadowMaskQualitySummary(bundle.shadowMask)}`)
  }

  return parts.join(' / ')
}

function fourCc(value: string): number {
  return (
  value.charCodeAt(0) |
  (value.charCodeAt(1) << 8) |
  (value.charCodeAt(2) << 16) |
  (value.charCodeAt(3) << 24)
  )
}

const align4 = (value: number): number => value + ((4 - (value % 4)) % 4)
