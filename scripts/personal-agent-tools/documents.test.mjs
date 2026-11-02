import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { documentCall } from './documents.mjs'

test('ported document extractors read actual synthetic DOCX and XLSX', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-documents-port-'))
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic document canary</w:t></w:r></w:p></w:body></w:document>')
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  await writeFile(join(root, 'sample.docx'), bytes)
  assert.match((await documentCall({ action: 'read', path: 'sample.docx' }, root)).text, /Synthetic document canary/)
  assert.deepEqual(await readFile(join(root, 'sample.docx')), bytes)
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Evidence').addRow(['canary', 17])
  await workbook.xlsx.writeFile(join(root, 'sample.xlsx'))
  const table = await documentCall({ action: 'read', path: 'sample.xlsx' }, root)
  assert.match(table.text, /canary.*17/)
  assert.equal(table.untrusted, true)
  await assert.rejects(documentCall({ action: 'read', path: '/etc/hosts', format: 'plain' }, root), /outside/)
})

test('ported PDF, PPTX, ODT and RTF extractors read real synthetic containers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-document-formats-'))
  const stream = 'BT /F1 12 Tf 72 720 Td (Synthetic PDF canary) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await writeFile(join(root, 'sample.pdf'), pdf)
  assert.match((await documentCall({ action: 'read', path: 'sample.pdf' }, root)).text, /Synthetic PDF canary/)
  const pptx = new JSZip()
  pptx.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Synthetic slide canary</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
  await writeFile(join(root, 'sample.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }))
  assert.match((await documentCall({ action: 'read', path: 'sample.pptx' }, root)).text, /Synthetic slide canary/)
  const odt = new JSZip()
  odt.file('content.xml', '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Synthetic ODT canary</text:p></office:text></office:body></office:document-content>')
  await writeFile(join(root, 'sample.odt'), await odt.generateAsync({ type: 'nodebuffer' }))
  assert.match((await documentCall({ action: 'read', path: 'sample.odt' }, root)).text, /Synthetic ODT canary/)
  await writeFile(join(root, 'sample.rtf'), '{\\rtf1\\ansi Synthetic RTF canary\\par}')
  assert.match((await documentCall({ action: 'read', path: 'sample.rtf' }, root)).text, /Synthetic RTF canary/)
})
