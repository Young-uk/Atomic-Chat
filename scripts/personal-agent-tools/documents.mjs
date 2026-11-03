import { personalWorkdir } from './verify.mjs'
import { realpath, stat, readFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep, extname } from 'node:path'
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
