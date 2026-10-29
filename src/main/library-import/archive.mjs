import { fail } from './shared.mjs'
import { MAX_IMPORT_BYTES } from './import.mjs'
const decoder = new TextDecoder('utf-8', { fatal: true })
const crc32 = (bytes) => {
  let crc = -1
  for (const byte of bytes) {
    crc ^= byte
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ -1) >>> 0
}
async function inflate (bytes, expected) {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const parts = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > expected || size > MAX_IMPORT_BYTES) { fail('import_archive_limit') }
      parts.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (size !== expected) fail('invalid_import_archive')
  const result = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    result.set(part, at)
    at += part.length
  }
  return result
}
export async function readPipePipeZip (input) {
  const bytes = new Uint8Array(input)
  if (bytes.length > MAX_IMPORT_BYTES || bytes.length < 22) { fail('import_archive_limit') }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      v.getUint32(i, true) === 0x06054b50 &&
      i + 22 + v.getUint16(i + 20, true) === bytes.length
    ) {
      end = i
      break
    }
  }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) { fail('invalid_import_archive') }
  const count = v.getUint16(end + 10, true)
  const start = v.getUint32(end + 16, true)
  const centralSize = v.getUint32(end + 12, true)
  if (
    !count ||
    count > 16 ||
    v.getUint16(end + 8, true) !== count ||
    start + centralSize !== end
  ) { fail('invalid_import_archive') }
  let at = start
  let found = null
  let total = 0
  const names = new Set()
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) { fail('invalid_import_archive') }
    const flags = v.getUint16(at + 8, true)
    const method = v.getUint16(at + 10, true)
    const crc = v.getUint32(at + 16, true)
    const compressed = v.getUint32(at + 20, true)
    const size = v.getUint32(at + 24, true)
    const n = v.getUint16(at + 28, true)
    const extra = v.getUint16(at + 30, true)
    const comment = v.getUint16(at + 32, true)
    const offset = v.getUint32(at + 42, true)
    if (
      at + 46 + n + extra + comment > end ||
      v.getUint16(at + 34, true) ||
      flags & 1 ||
      ![0, 8].includes(method)
    ) { fail('unsupported_import_archive') }
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + n))
    if (
      !name ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('\0') ||
      names.has(name)
    ) { fail('invalid_import_archive') }
    names.add(name)
    total += size
    if (size > MAX_IMPORT_BYTES || total > MAX_IMPORT_BYTES * 2) { fail('import_archive_limit') }
    if (
      offset + 30 > start ||
      v.getUint32(offset, true) !== 0x04034b50 ||
      v.getUint16(offset + 8, true) !== method ||
      v.getUint16(offset + 6, true) !== flags
    ) { fail('invalid_import_archive') }
    const localNameSize = v.getUint16(offset + 26, true)
    const data = offset + 30 + localNameSize + v.getUint16(offset + 28, true)
    if (
      data + compressed > start ||
      decoder.decode(
        bytes.subarray(offset + 30, offset + 30 + localNameSize)
      ) !== name
    ) { fail('invalid_import_archive') }
    if (name === 'newpipe.db') found = { method, crc, compressed, size, data }
    at += 46 + n + extra + comment
  }
  if (at !== end || !found) fail('pipepipe_database_missing')
  const stored = bytes.subarray(found.data, found.data + found.compressed)
  const db =
    found.method === 0 ? stored.slice() : await inflate(stored, found.size)
  if (
    db.length !== found.size ||
    crc32(db) !== found.crc ||
    decoder.decode(db.subarray(0, 15)) !== 'SQLite format 3'
  ) { fail('invalid_import_database') }
  return db
}
