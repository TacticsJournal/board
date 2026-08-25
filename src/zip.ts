export type ZipFile = {
  name: string
  data: Uint8Array
}

const encoder = new TextEncoder()

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < table.length; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    table[n] = value >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function header(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size)
  return { bytes, view: new DataView(bytes.buffer) }
}

/** Build a ZIP without recompressing files that are already compressed, such as PNGs. */
export function zipFiles(files: readonly ZipFile[]): Blob {
  if (files.length > 0xffff) throw new Error('Too many files for one ZIP.')

  const localParts: BlobPart[] = []
  const centralParts: BlobPart[] = []
  let localOffset = 0
  let centralSize = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    if (!name.length || name.length > 0xffff) throw new Error('A ZIP filename is invalid.')
    if (file.data.byteLength > 0xffffffff) throw new Error('A file is too large for one ZIP.')
    const checksum = crc32(file.data)

    const local = header(30)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint16(4, 20, true)
    local.view.setUint16(6, 0x0800, true)
    local.view.setUint16(8, 0, true)
    local.view.setUint16(12, 0x0021, true)
    local.view.setUint32(14, checksum, true)
    local.view.setUint32(18, file.data.byteLength, true)
    local.view.setUint32(22, file.data.byteLength, true)
    local.view.setUint16(26, name.byteLength, true)
    localParts.push(local.bytes, name, file.data)

    const central = header(46)
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, 20, true)
    central.view.setUint16(6, 20, true)
    central.view.setUint16(8, 0x0800, true)
    central.view.setUint16(10, 0, true)
    central.view.setUint16(14, 0x0021, true)
    central.view.setUint32(16, checksum, true)
    central.view.setUint32(20, file.data.byteLength, true)
    central.view.setUint32(24, file.data.byteLength, true)
    central.view.setUint16(28, name.byteLength, true)
    central.view.setUint32(42, localOffset, true)
    centralParts.push(central.bytes, name)

    localOffset += local.bytes.byteLength + name.byteLength + file.data.byteLength
    centralSize += central.bytes.byteLength + name.byteLength
    if (localOffset > 0xffffffff || centralSize > 0xffffffff) throw new Error('The project is too large for one ZIP.')
  }

  const end = header(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(8, files.length, true)
  end.view.setUint16(10, files.length, true)
  end.view.setUint32(12, centralSize, true)
  end.view.setUint32(16, localOffset, true)

  return new Blob([...localParts, ...centralParts, end.bytes], { type: 'application/zip' })
}
