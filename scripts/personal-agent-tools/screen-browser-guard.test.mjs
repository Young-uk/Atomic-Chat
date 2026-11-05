import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { SCREEN_JXA_SOURCE } from './agent-source/suite/tools/os/screen/screen-jxa.mjs'

test('browser input asks for sensitive and unknown targets and rejects a changed target', () => {
  let target
  const guard = runInNewContext(SCREEN_JXA_SOURCE + '\nguardBrowser', {
    ObjC: { import() {}, unwrap: value => value, castRefToObject: value => value },
    Ref: () => [],
    $: Object.assign(value => value, {
      AXUIElementCreateApplication: () => ({ AXFocusedUIElement: target }),
      AXUIElementCopyElementAtPosition: (_root, _x, _y, out) => { out[0] = target; return target ? 0 : 1 },
      AXUIElementCopyAttributeValue: (element, name, out) => {
        if (!(name in element)) return 1
        out[0] = element[name]
        return 0
      },
    }),
  })
  const app = { pid: 42 }
  const click = { browserGuard: true, op: 'click', button: 'left' }
  const type = { browserGuard: true, op: 'type', text: 'sample' }

  target = { AXRole: 'AXLink', AXTitle: 'Documentation' }
  assert.equal(guard(click, app, {}), false)
  target = { AXRole: 'AXTextField', AXTitle: 'Search' }
  assert.equal(guard(type, app, {}), false)
  target = { AXRole: 'AXTextField', AXSubrole: 'AXSecureTextField' }
  const proposal = {}
  assert.equal(guard(type, app, proposal), true)
  assert.equal(proposal.error, 'browser-approval')
  assert.equal(guard({ ...type, browserApproved: proposal.browserTarget }, app, {}), false)
  target = { AXRole: 'AXLink', AXTitle: 'Place order' }
  assert.equal(guard(click, app, {}), true)
  const changed = {}
  assert.equal(guard({ ...type, browserApproved: proposal.browserTarget }, app, changed), true)
  assert.equal(changed.error, 'browser-target-changed')
  target = undefined
  assert.equal(guard(type, app, {}), true)
})
