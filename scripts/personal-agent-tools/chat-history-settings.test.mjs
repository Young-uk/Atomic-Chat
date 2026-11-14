import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FEATURE_SETTINGS, validateFeatureSettings } from './feature-settings.mjs'

test('history identity groups are opt-in, disjoint, bounded and preserved through other settings', () => {
  const original = structuredClone(DEFAULT_FEATURE_SETTINGS)
  assert.equal(validateFeatureSettings(original).chatHistory, undefined)
  const input = { ...original, chatHistory: { assistantGroups: [['winter', 'winter-old']] } }
  const checked = validateFeatureSettings(input)
  input.chatHistory.assistantGroups[0].push('later')
  assert.deepEqual(checked.chatHistory.assistantGroups, [['winter', 'winter-old']])
  const updated = validateFeatureSettings({ ...checked, memoryMaintenance: { ...checked.memoryMaintenance, backgroundReview: true } })
  assert.deepEqual(updated.chatHistory, checked.chatHistory)
  for (const assistantGroups of [[['one']], [['one', 'one']], [['one', 'two'], ['two', 'three']], [['one', '../escape']], 'one']) {
    assert.throws(() => validateFeatureSettings({ ...original, chatHistory: { assistantGroups } }))
  }
  assert.throws(() => validateFeatureSettings({ ...original, chatHistory: { assistantGroups: [], allowAll: true } }))
})
