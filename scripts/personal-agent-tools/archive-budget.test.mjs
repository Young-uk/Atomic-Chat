import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import JSZip from 'jszip'
import { validateZipDirectory, boundedZipRead, collectBounded } from './agent-source/suite/tools/os/archive/archive-budget.mjs'
import { GzipBackend } from './agent-source/suite/tools/os/archive/gz-backend.mjs'

test('ZIP declaration is rejected before inflation and ordinary content remains readable', async () => {
  const zip = new JSZip()
  zip.file('sample.txt', 'synthetic archive text')
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  validateZipDirectory(bytes)
  const parsed = await JSZip.loadAsync(bytes)
  assert.equal((await boundedZipRead(parsed.file('sample.txt'))).toString(), 'synthetic archive text')
  const oversized = Buffer.from(bytes)
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  oversized.writeUInt32LE(11 * 1024 * 1024, central + 24)
  assert.throws(() => validateZipDirectory(oversized), /byte budget/)
  assert.throws(() => validateZipDirectory(Buffer.from('not a zip')), /Invalid ZIP/)
})

test('stream and gzip expansion stop at the Personal byte budget', async () => {
  async function* chunks() { yield Buffer.alloc(4); yield Buffer.alloc(4) }
  await assert.rejects(collectBounded(chunks(), 5), /byte budget/)
  const backend = new GzipBackend('sample.txt.gz')
  assert.equal((await backend.readEntry(gzipSync('small'), 'sample.txt')).toString(), 'small')
  await assert.rejects(backend.readEntry(gzipSync(Buffer.alloc(11 * 1024 * 1024)), 'sample.txt'), /larger than|size|length/i)
})
