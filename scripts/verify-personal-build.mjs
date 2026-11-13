import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function verifyPersonalBuild(manifest) {
  if (manifest?.version !== 1 || manifest.personal !== true ||
      manifest.appendEffort !== true || manifest.backgroundCompaction !== true) {
    throw new Error('Personal build feature gates are missing; do not install this artifact')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPersonalBuild(JSON.parse(await readFile(new URL('../web-app/dist/atomic-build.json', import.meta.url), 'utf8')))
  console.log('Verified personal frontend build capabilities')
}
