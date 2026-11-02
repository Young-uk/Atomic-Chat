import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { parsePorcelain } from './agent-source/git-status-parser.mjs'

const execute = promisify(execFile)
export async function gitCall(args, workspace) {
  const root = await realpath(workspace)
  const repo = await realpath(resolve(root, args.repo ?? '.'))
  const rel = relative(root, repo)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Repository is outside the Personal workspace')
  // No provider credentials, injected Git configuration or credential prompts
  // are inherited by the read-only subprocess. External diff/textconv are off.
  const env = Object.fromEntries(['PATH','HOME','USERPROFILE','SystemRoot','TMPDIR','TEMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
  Object.assign(env, { GIT_PAGER: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
  async function run(argv) {
    const result = await execute('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...argv], { cwd: repo, env, timeout: 15000, maxBuffer: 512 * 1024, windowsHide: true })
    return result.stdout
  }
  const repository = (await run(['rev-parse', '--show-toplevel'])).trim()
  const repositoryRel = relative(root, await realpath(repository))
  if (isAbsolute(repositoryRel) || repositoryRel === '..' || repositoryRel.startsWith(`..${sep}`)) throw new Error('Repository root is outside the Personal workspace')
  if (args.action === 'status') {
    const status = parsePorcelain(await run(['status','--porcelain=v1','-z','--branch']))
    return { repo: repository, ...status, entries: status.entries.slice(0,100), total: status.entries.length, truncated: status.entries.length > 100, untrusted: true }
  }
  const ref = args.ref ?? 'HEAD'
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\0\r\n]/.test(ref) || ref.length > 500) throw new Error('Invalid Git revision')
  let argv
  if (args.action === 'log') argv = ['log', '-20', '--format=%H%x09%aI%x09%s', '--end-of-options', ref]
  else if (args.action === 'diff') argv = ['diff','--no-ext-diff','--no-textconv','--end-of-options',ref,'--']
  else if (args.action === 'show') argv = ['show','--no-ext-diff','--no-textconv','--format=fuller','--end-of-options',ref]
  else if (args.action === 'branches') argv = ['branch','--list','--no-color']
  else throw new Error('Unknown Git read action')
  const output = await run(argv)
  return { repo: repository, output: output.slice(0,40000), truncated: output.length > 40000, untrusted: true }
}
