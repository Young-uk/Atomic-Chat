import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gitCall } from './git.mjs'
const execute = promisify(execFile)

test('Git read adapter reports real synthetic status and patch without changing the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atomic-git-port-'))
  const git = async args => (await execute('git', args, { cwd: root })).stdout
  await git(['init','--initial-branch=qa'])
  await writeFile(join(root, 'canary.txt'), 'before\n')
  await git(['add','--','canary.txt'])
  await git(['-c','user.name=Synthetic QA','-c','user.email=qa@example.invalid','-c','core.hooksPath=/dev/null','commit','-m','Synthetic fixture'])
  await writeFile(join(root, 'canary.txt'), 'after\n')
  await writeFile(join(root, 'untracked\nname.txt'), 'data')
  const before = await git(['status','--porcelain=v1','-z'])
  const status = await gitCall({ action: 'status' }, root)
  assert.equal(status.entries.length, 2)
  assert.ok(status.entries.some(row => row.path === 'untracked\nname.txt'))
  assert.match((await gitCall({ action: 'diff' }, root)).output, /\+after/)
  assert.match((await gitCall({ action: 'log' }, root)).output, /Synthetic fixture/)
  assert.equal(await git(['status','--porcelain=v1','-z']), before)
  await assert.rejects(gitCall({ action: 'show', ref: '--output=/tmp/should-not-exist' }, root), /Invalid/)
  await assert.rejects(gitCall({ action: 'status', repo: '/private/tmp' }, root), /outside/)
})
