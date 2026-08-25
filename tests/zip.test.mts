import assert from 'node:assert/strict'
import test from 'node:test'

import { crc32, zipFiles } from '../src/zip.ts'

const text = (value: string) => new TextEncoder().encode(value)

function entries(bytes: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.byteLength - 22
  assert.equal(view.getUint32(end, true), 0x06054b50)
  const count = view.getUint16(end + 10, true)
  const centralOffset = view.getUint32(end + 16, true)
  const found = []
  let offset = 0
  while (offset < centralOffset) {
    assert.equal(view.getUint32(offset, true), 0x04034b50)
    assert.equal(view.getUint16(offset + 6, true), 0x0800)
    assert.equal(view.getUint16(offset + 8, true), 0)
    const crc = view.getUint32(offset + 14, true)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameAt = offset + 30
    const dataAt = nameAt + nameLength + extraLength
    found.push({
      name: new TextDecoder().decode(bytes.subarray(nameAt, nameAt + nameLength)),
      data: bytes.slice(dataAt, dataAt + size),
      crc,
    })
    offset = dataAt + size
  }
  assert.equal(found.length, count)
  return found
}

test('crc32 matches the ZIP checksum for a known value', () => {
  assert.equal(crc32(text('123456789')), 0xcbf43926)
})

test('zipFiles stores every file with its UTF-8 name and bytes intact', async () => {
  const blob = zipFiles([
    { name: '01-board-one.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    { name: '02-café.png', data: text('second') },
  ])
  assert.equal(blob.type, 'application/zip')

  const files = entries(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(files.map(file => file.name), ['01-board-one.png', '02-café.png'])
  assert.deepEqual([...files[0].data], [0x89, 0x50, 0x4e, 0x47])
  assert.equal(new TextDecoder().decode(files[1].data), 'second')
  assert.equal(files[0].crc, crc32(files[0].data))
  assert.equal(files[1].crc, crc32(files[1].data))
})

test('zipFiles makes a valid empty archive', async () => {
  const bytes = new Uint8Array(await zipFiles([]).arrayBuffer())
  assert.equal(bytes.byteLength, 22)
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x06054b50)
})
