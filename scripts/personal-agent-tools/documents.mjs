import { homedir } from 'node:os'
import { personalWorkdir } from './verify.mjs'
import { realpath, stat, readFile, open } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep, extname, join } from 'node:path'
import { pdfExtractor } from './agent-source/documents/pdf-extractor.mjs'
import { docxExtractor } from './agent-source/documents/docx-extractor.mjs'
import { docExtractor } from './agent-source/documents/doc-extractor.mjs'
import { xlsxExtractor } from './agent-source/documents/xlsx-extractor.mjs'
import { pptxExtractor } from './agent-source/documents/pptx-extractor.mjs'
import { odtExtractor } from './agent-source/documents/odt-extractor.mjs'
import { rtfExtractor } from './agent-source/documents/rtf-extractor.mjs'
import { plainTextExtractor } from './agent-source/documents/plain-text-extractor.mjs'
import { validateZipDirectory } from './agent-source/suite/tools/os/archive/archive-budget.mjs'

const extractors = { pdf: pdfExtractor, docx: docxExtractor, doc: docExtractor, xlsx: xlsxExtractor, pptx: pptxExtractor, odt: odtExtractor, rtf: rtfExtractor, plain: plainTextExtractor }
export async function documentCall(args, workspace, threadId) {
  if (args.action === 'logs') return logTail(args)
  if (args.action !== 'read' || typeof args.path !== 'string' || !args.path.trim()) throw new Error('A document path is required')
  const root = await realpath(workspace)
  const path = await realpath(resolve(personalWorkdir(root, threadId), args.path))
  const rel = relative(root, path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Document is outside the Personal workspace')
  const info = await stat(path)
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Document must be a regular file no larger than 20 MiB')
  const format = args.format ?? extname(path).slice(1).toLowerCase()
  const extractor = extractors[format]
  if (!extractor) throw new Error('Unsupported format; use pdf, docx, doc, xlsx, pptx, odt, rtf or plain')
  for (const key of ['pagesFrom', 'pagesTo']) if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 1)) throw new Error(`${key} must be a positive integer`)
  if (args.pagesFrom && args.pagesTo && args.pagesFrom > args.pagesTo) throw new Error('Invalid page range')
  const data = await readFile(path)
  // Office containers can be small on disk and enormous after inflation.
  // Validate their declared expansion before invoking a document extractor.
  if (['docx', 'xlsx', 'pptx', 'odt'].includes(format)) validateZipDirectory(data)
  const result = await extractor({ data, sourcePath: path, pagesFrom: args.pagesFrom, pagesTo: args.pagesTo, maxPages: 100 })
  return { ...result, path, text: result.text.slice(0, 40000), truncated: result.text.length > 40000, untrusted: true }
}

// Fixed local diagnostic sources, separate from general workspace reads.
export async function logTail(args, home = homedir()) {
  const support = join(home, 'Library/Application Support')
  const sources = {
    app: join(support, 'Atomic Chat/data/logs/app.log'),
    core: join(support, 'Atomic Chat/data/atomic-core/logs/core.log'),
    dstar: join(support, 'dstar/logs/atomic-dstar.log'),
    strata: join(support, 'dstar/logs/atomic-strata.log'),
    strata_native: join(home, 'strata-iq2-comparison-nov08/strata-atomic.log'),
    worker: join(support, 'Atomic Chat Personal Tools/worker.log'),
  }
  if (!Object.hasOwn(sources, args.source)) throw new Error(`Choose a log source: ${Object.keys(sources).join(', ')}`)
  if (['path', 'format', 'pagesFrom', 'pagesTo'].some(key => args[key] !== undefined)) throw new Error('Log reads use source and lines, not document paths or formats')
  const lines = args.lines ?? 100
  if (!Number.isSafeInteger(lines) || lines < 1 || lines > 500) throw new Error('Log lines must be between 1 and 500')
  const path = sources[args.source]
  // Resolve the expected parent independently so a file symlink cannot turn
  // the diagnostic reader into an arbitrary host-file reader.
  const parent = await realpath(resolve(path, '..'))
  const actual = await realpath(path)
  if (actual !== resolve(parent, path.slice(path.lastIndexOf('/') + 1))) throw new Error('Log file symlinks are not supported')
  const handle = await open(actual, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Log must be a regular file')
    const start = Math.max(0, info.size - 256 * 1024)
    const data = Buffer.alloc(info.size - start)
    const { bytesRead } = await handle.read(data, 0, data.length, start)
    let entries = data.subarray(0, bytesRead).toString('utf8').split(/\r?\n/)
    if (start) entries.shift()
    if (entries.at(-1) === '') entries.pop()
    const truncated = start > 0 || entries.length > lines
    const text = entries.slice(-lines).join('\n')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+\/=-]+/gi, '$1[redacted]')
      .replace(/((?:api[_-]?key|authorization|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]')
    return { source: args.source, path, text, truncated, untrusted: true }
  } finally { await handle.close() }
}
