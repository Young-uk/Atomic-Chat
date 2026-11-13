import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyPersonalBuild } from '../scripts/verify-personal-build.mjs'

test('rejects generic, incomplete and stale artifacts', () => {
  const valid = { version: 1, personal: true, appendEffort: true, backgroundCompaction: true }
  assert.doesNotThrow(() => verifyPersonalBuild(valid))
  for (const change of [{ personal: false }, { backgroundCompaction: false }, { appendEffort: false }, { version: 0 }])
    assert.throws(() => verifyPersonalBuild({ ...valid, ...change }), /do not install/)
  assert.throws(() => verifyPersonalBuild(undefined), /do not install/)
})
