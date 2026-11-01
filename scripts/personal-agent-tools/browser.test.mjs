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
