// Shared fixture: build a standard ZIP archive in memory (local headers,
// central directory, EOCD) with stored (0) and deflate (8) entries, so the
// import pipeline can be tested without external tooling. CRC32 comes from
// node:zlib (Node >= 20.15).

import { deflateRawSync, crc32 } from 'node:zlib'

export function buildZip(entries) {
  const list = entries.map((e) => {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8')
    const method = e.method === 0 ? 0 : 8
    const raw = method === 0 ? data : deflateRawSync(data)
    const nameBuf = Buffer.from(String(e.name), 'utf8')
    const isDir = e.dir === true || String(e.name).endsWith('/')
    const crc = crc32(data)
    return { name: String(e.name), nameBuf, method, raw, size: data.length, crc, isDir }
  })

  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of list) {
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x800, 6) // UTF-8 names
    local.writeUInt16LE(e.method, 8)
    local.writeUInt32LE(e.crc, 14)
    local.writeUInt32LE(e.raw.length, 18)
    local.writeUInt32LE(e.size, 22)
    local.writeUInt16LE(e.nameBuf.length, 26)
    localParts.push(local, e.nameBuf, e.raw)
    offset += 30 + e.nameBuf.length + e.raw.length

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(e.method, 10)
    central.writeUInt32LE(e.crc, 16)
    central.writeUInt32LE(e.raw.length, 20)
    central.writeUInt32LE(e.size, 24)
    central.writeUInt16LE(e.nameBuf.length, 28)
    central.writeUInt32LE(e.isDir ? 0x10 : 0, 38) // DOS directory bit
    central.writeUInt32LE(offset - (30 + e.nameBuf.length + e.raw.length), 42) // local header offset
    centralParts.push(central, e.nameBuf)
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(list.length, 8)
  eocd.writeUInt16LE(list.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(Buffer.concat(localParts).length, 16)

  return Buffer.concat([...localParts, centralBuf, eocd])
}
