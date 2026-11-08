import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PersonalBrowser } from './browser.mjs'

function fixture() {
  let clicks = 0
  const handle = {
    evaluate: async () => ({ tag: 'button', type: 'button', label: 'Details', visible: true }),
    dispose: async () => {}, click: async () => { clicks++ },
  }
  const page = {
    isClosed: () => false, url: () => 'https://93.184.216.34/', title: async () => 'Fixture',
    goto: async () => {}, close: async () => {},
    locator: selector => selector === 'body' ? { innerText: async () => 'Fixture text' } : { elementHandles: async () => [handle] },
  }
  const context = { pages: () => [], setDefaultTimeout: () => {}, route: async () => {}, newPage: async () => page, close: async () => {} }
  const browser = new PersonalBrowser('/unused-test-profile', async () => ({ launchPersistentContext: async () => context }))
  return { browser, clicks: () => clicks }
}

test('an action cannot use an unobserved or already consumed element reference', async () => {
  const { browser, clicks } = fixture()
  await browser.call('open', { url: 'https://93.184.216.34/' })
  await assert.rejects(browser.call('click', { tab: '1', ref: 'e1' }), /Read this page first/)
  const snapshot = await browser.call('read', { tab: '1' })
  assert.equal(snapshot.untrustedPageContent, true)
  await browser.call('click', { tab: '1', ref: snapshot.elements[0].ref })
  await assert.rejects(browser.call('click', { tab: '1', ref: 'e1' }))
  assert.equal(clicks(), 1)
})

test('navigation invalidates earlier references', async () => {
  const { browser } = fixture()
  await browser.call('open', { url: 'https://93.184.216.34/' })
  await browser.call('read', { tab: '1' })
  await browser.call('navigate', { tab: '1', url: 'https://93.184.216.34/new' })
  await assert.rejects(browser.call('click', { tab: '1', ref: 'e1' }))
})

test('scroll reports movement, clamped boundaries and a nested target', async () => {
  const { scrollState } = await import('./browser.mjs')
  const previousDocument = globalThis.document
  const previousStyle = globalThis.getComputedStyle
  const root = { scrollTop: 0, clientHeight: 800, scrollHeight: 1800 }
  root.scrollBy = ({ top }) => { root.scrollTop = Math.max(0, Math.min(1000, root.scrollTop + top)) }
  const nested = { scrollTop: 0, clientHeight: 200, scrollHeight: 500, parentElement: root }
  nested.scrollBy = ({ top }) => { nested.scrollTop = Math.max(0, Math.min(300, nested.scrollTop + top)) }
  globalThis.document = { scrollingElement: root }
  globalThis.getComputedStyle = () => ({ overflowY: 'auto' })
  try {
    assert.equal(scrollState({ direction: 'down' }).delta, 600)
    const bottom = scrollState({ direction: 'down' })
    assert.equal(bottom.delta, 400)
    assert.equal(bottom.atBottom, true)
    const stopped = scrollState({ direction: 'down' })
    assert.equal(stopped.moved, false)
    assert.match(stopped.next, /Do not repeat/)
    assert.equal(scrollState({ direction: 'up' }).delta, -600)
    const inner = scrollState({ parentElement: nested }, { direction: 'down' })
    assert.equal(inner.target, 'element')
    assert.equal(inner.delta, 300)
    assert.equal(inner.atBottom, true)
    assert.equal(root.scrollTop, 400)
  } finally {
    globalThis.document = previousDocument
    globalThis.getComputedStyle = previousStyle
  }
})

test('rereading never reassigns a stale ref to a different target', async () => {
  const { browser } = fixture()
  await browser.call('open', { url: 'https://93.184.216.34/' })
  const first = await browser.call('read', { tab: '1' })
  const second = await browser.call('read', { tab: '1' })
  assert.notEqual(first.elements[0].ref, second.elements[0].ref)
  await assert.rejects(browser.call('click', { tab: '1', ref: first.elements[0].ref }), /Read this page first/)
})

test('hidden prefixes cannot crowd out visible targets and later targets are paginated', async () => {
  const { browser } = fixture()
  await browser.call('open', { url: 'https://93.184.216.34/' })
  let disposed = 0
  const handles = Array.from({ length: 405 }, (_, index) => ({
    evaluate: async () => ({ tag: 'button', label: `Target ${index}`, visible: index >= 200 }),
    dispose: async () => { disposed++ },
  }))
  browser.tabs.get('1').locator = selector => selector === 'body'
    ? { innerText: async () => 'Fixture' }
    : { elementHandles: async () => handles }
  const first = await browser.call('read', { tab: '1' })
  assert.equal(first.elements.length, 200)
  assert.equal(first.elements[0].label, 'Target 200')
  assert.equal(first.totalElements, 205)
  assert.equal(first.nextOffset, 200)
  assert.equal(disposed, 205)
  const next = await browser.call('read', { tab: '1', offset: first.nextOffset })
  assert.equal(next.elements.length, 5)
  assert.equal(next.elements[0].label, 'Target 400')
  assert.equal(next.nextOffset, null)
  await assert.rejects(browser.call('read', { tab: '1', offset: -1 }), /offset/)
})
