import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parseVerifySyntaxArgs, verifySyntax } from './agent-source/verify-syntax.mjs'

// The checker implementation is ported source. Chat supplies the workspace
// boundary and its existing per-call approval, rather than an Agent runtime.
export async function verifyCall(args, workspace, threadId) {
  if (args.action !== 'syntax') throw new Error('Unknown verification action')
  const files = parseVerifySyntaxArgs(args)
  const root = await realpath(workspace)
  // Match run_script's per-chat working directory. Legacy callers without
  // chat context continue to resolve relative paths against the shared root.
  if (threadId !== undefined && (typeof threadId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(threadId))) throw new Error('Invalid verification thread id')
  const base = threadId === undefined ? root : resolve(root, 'chat', threadId)
  const paths = []
  for (const file of files) {
    const path = await realpath(resolve(base, file))
    const rel = relative(root, path)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Verification path is outside the Personal workspace')
    const info = await stat(path)
    if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('Verification requires regular files no larger than 4 MiB')
    paths.push(path)
  }
  return verifySyntax(paths, root)
}
