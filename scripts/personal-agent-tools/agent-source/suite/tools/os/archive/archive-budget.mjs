import { Readable } from "node:stream";
const PERSONAL_ARCHIVE_INPUT_BYTES = 64 * 1024 * 1024;
const PERSONAL_ARCHIVE_ENTRY_BYTES = 10 * 1024 * 1024;
const TOTAL = 100 * 1024 * 1024;
function validateZipDirectory(data) {
  let end = -1;
  for (let at2 = data.length - 22; at2 >= Math.max(0, data.length - 65557); at2--) {
    if (data.readUInt32LE(at2) === 101010256 && at2 + 22 + data.readUInt16LE(at2 + 20) === data.length) {
      end = at2;
      break;
    }
  }
  if (end < 0) throw new Error("Invalid ZIP directory");
  const count = data.readUInt16LE(end + 10);
  const offset = data.readUInt32LE(end + 16);
  if (count > 1e4 || count === 65535 || offset === 4294967295) throw new Error("ZIP directory exceeds the Personal archive entry budget");
  let at = offset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== 33639248) throw new Error("Invalid ZIP central directory entry");
    const bytes = data.readUInt32LE(at + 24);
    total += bytes;
    if (bytes > PERSONAL_ARCHIVE_ENTRY_BYTES || total > TOTAL) throw new Error("ZIP expanded content exceeds the Personal archive byte budget");
    at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }
}
async function collectBounded(stream, limit = PERSONAL_ARCHIVE_ENTRY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error("Expanded archive entry exceeds the Personal byte budget");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}
function boundedZipRead(file, limit = PERSONAL_ARCHIVE_ENTRY_BYTES) {
  return collectBounded(new Readable().wrap(file.nodeStream("nodebuffer")), Math.min(limit, PERSONAL_ARCHIVE_ENTRY_BYTES));
}
export {
  PERSONAL_ARCHIVE_ENTRY_BYTES,
  PERSONAL_ARCHIVE_INPUT_BYTES,
  boundedZipRead,
  collectBounded,
  validateZipDirectory
};
