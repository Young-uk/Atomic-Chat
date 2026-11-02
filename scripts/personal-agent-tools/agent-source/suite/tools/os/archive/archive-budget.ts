import type JSZip from 'jszip'
import { Readable } from 'node:stream'

export const PERSONAL_ARCHIVE_INPUT_BYTES = 64 * 1024 * 1024
export const PERSONAL_ARCHIVE_ENTRY_BYTES = 10 * 1024 * 1024
const TOTAL = 100 * 1024 * 1024

/** Check the ZIP directory before JSZip allocates entry objects or inflates
 * bodies. A bounded Personal tool reports oversized/ZIP64 inputs explicitly. */
export function validateZipDirectory(data: Buffer): void {
  let end = -1
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) {
    if (data.readUInt32LE(at) === 0x06054b50 && at + 22 + data.readUInt16LE(at + 20) === data.length) { end = at; break }
  }
  if (end < 0) throw new Error('Invalid ZIP directory')
  const count = data.readUInt16LE(end + 10)
  const offset = data.readUInt32LE(end + 16)
  if (count > 10000 || count === 65535 || offset === 0xffffffff) throw new Error('ZIP directory exceeds the Personal archive entry budget')
  let at = offset
  let total = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry')
    const bytes = data.readUInt32LE(at + 24)
    total += bytes
    if (bytes > PERSONAL_ARCHIVE_ENTRY_BYTES || total > TOTAL) throw new Error('ZIP expanded content exceeds the Personal archive byte budget')
    at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32)
  }
}

export async function collectBounded(stream: AsyncIterable<Buffer | Uint8Array>, limit = PERSONAL_ARCHIVE_ENTRY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) throw new Error('Expanded archive entry exceeds the Personal byte budget')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, size)
}

export function boundedZipRead(file: JSZip.JSZipObject, limit = PERSONAL_ARCHIVE_ENTRY_BYTES): Promise<Buffer> {
  // JSZip uses readable-stream v2, which has no async iterator. Wrap it in
  // Node's bounded pull stream before collecting; never use file.async().
  return collectBounded(new Readable().wrap(file.nodeStream('nodebuffer')), Math.min(limit, PERSONAL_ARCHIVE_ENTRY_BYTES))
}
