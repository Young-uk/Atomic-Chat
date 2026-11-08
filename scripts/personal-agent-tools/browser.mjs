import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)))
  }
  // Only globally routable IPv6; reject mapped IPv4 and local networks.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
}

export async function publicUrl(value, lookup = async host => [...await resolve4(host).catch(() => []), ...await resolve6(host).catch(() => [])]) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs without embedded credentials are allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : await lookup(host)
  if (!addresses.length || addresses.some(address => !publicAddress(address))) throw new Error('Private or unresolved browser address is blocked')
  return url.href
}

// Runs in the page. Explicit targets avoid wheel events scrolling whichever
// unrelated element happens to be under the last mouse position.
export function scrollState(input, options = null) {
  const element = options ? input : null
  const { direction } = options || input
  const root = document.scrollingElement || document.documentElement
  let target = element || root
  while (target !== root && target) {
    const overflow = getComputedStyle(target).overflowY
    if (target.scrollHeight > target.clientHeight && /auto|scroll|overlay/.test(overflow)) break
    target = target.parentElement || root
  }
  const before = target.scrollTop
  target.scrollBy({ top: direction === 'up' ? -600 : 600, behavior: 'instant' })
  const after = target.scrollTop
  const viewportHeight = target.clientHeight
  const contentHeight = target.scrollHeight
  const moved = Math.abs(after - before) > 0.5
  return {
    target: target === root ? 'document' : 'element',
    positionBefore: before, positionAfter: after, delta: after - before,
    viewportHeight, contentHeight, moved,
    atTop: after <= 1, atBottom: after + viewportHeight >= contentHeight - 1,
    next: moved ? 'Inspect the page with read or screenshot before scrolling again.' : 'No movement. Do not repeat the same scroll. Inspect with read or screenshot; the boundary may be reached or another scroll target may be needed.',
  }
}

export class PersonalBrowser {
  constructor(directory, chromiumLoader = async () => (await import('playwright-core')).chromium) {
    this.directory = directory
    this.loadChromium = chromiumLoader
    this.tabs = new Map()
    this.nextTab = 1
    this.nextRef = 1
    this.refs = new Map()
  }
  async ready() {
    if (!this.context) {
      const chromium = await this.loadChromium()
      this.context = await chromium.launchPersistentContext(this.directory, { channel: 'chrome', headless: false, acceptDownloads: false })
      this.context.setDefaultTimeout(10000)
      await this.context.route('**/*', async route => {
        try { await publicUrl(route.request().url()); await route.continue() }
        catch { await route.abort() }
      })
      // Never operate in the user's ordinary Chrome profile or its tabs.
      for (const page of this.context.pages()) await page.close()
    }
  }
  async invalidate(tab) {
    const refs = this.refs.get(tab)
    this.refs.delete(tab)
    await Promise.allSettled([...(refs?.values() ?? [])].map(handle => handle.dispose()))
  }
  page(id) {
    const page = this.tabs.get(id)
    if (!page || page.isClosed()) throw new Error('Unknown tab; list tabs or open a new one')
    return page
  }
  async call(action, args) {
    await this.ready()
    if (action === 'tabs') return Promise.all([...this.tabs].filter(([, page]) => !page.isClosed()).map(async ([tab, page]) => ({ tab, title: await page.title(), url: page.url() })))
    if (action === 'open') {
      const url = await publicUrl(args.url)
      const page = await this.context.newPage()
      const tab = String(this.nextTab++)
      this.tabs.set(tab, page)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      return { tab, url: page.url(), next: 'Read this tab before using element references.' }
    }
    const page = this.page(args.tab)
    if (action === 'close') { await page.close(); this.tabs.delete(args.tab); await this.invalidate(args.tab); return { closed: args.tab } }
    if (action === 'navigate') {
      await this.invalidate(args.tab)
      await page.goto(await publicUrl(args.url), { waitUntil: 'domcontentloaded', timeout: 20000 })
      return { tab: args.tab, url: page.url() }
    }
    if (action === 'read') {
      await publicUrl(page.url())
      const offset = args.offset ?? 0
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Read offset must be a nonnegative integer')
      const handles = await page.locator('a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="radio"],[role="combobox"],[contenteditable="true"],[tabindex],[onclick]').elementHandles()
      const refs = new Map()
      const elements = []
      let visibleCount = 0
      for (const handle of handles) {
        const info = await handle.evaluate(el => {
          const style = getComputedStyle(el)
          return { tag: el.tagName.toLowerCase(), type: el.getAttribute('type'),
            role: el.getAttribute('role'),
            label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || el.getAttribute('alt') || '').slice(0, 150),
            visible: Boolean(el.getClientRects().length) && style.visibility !== 'hidden' && style.visibility !== 'collapse' }
        }).catch(() => null)
        if (!info?.visible || ['password', 'hidden'].includes(info.type)) { await handle.dispose(); continue }
        const index = visibleCount++
        if (index < offset || elements.length >= 200) { await handle.dispose(); continue }
        const ref = `e${this.nextRef++}`
        refs.set(ref, handle)
        elements.push({ ref, ...info })
      }
      await this.invalidate(args.tab)
      this.refs.set(args.tab, refs)
      return { untrustedPageContent: true, tab: args.tab, url: page.url(), title: await page.title(), offset, totalElements: visibleCount, nextOffset: offset + elements.length < visibleCount ? offset + elements.length : null, text: (await page.locator('body').innerText()).slice(0, 16000), elements }
    }
    if (action === 'scroll') {
      if (!['up', 'down'].includes(args.direction)) throw new Error('Scroll direction must be up or down')
      const element = args.ref ? this.refs.get(args.tab)?.get(args.ref) : null
      if (args.ref && !element) throw new Error('Read this page first, then use a current element reference')
      const result = element
        ? await element.evaluate(scrollState, { direction: args.direction })
        : await page.evaluate(scrollState, { direction: args.direction })
      await this.invalidate(args.tab)
      return { tab: args.tab, ref: args.ref ?? null, ...result }
    }
    if (action === 'screenshot') return { image: await page.screenshot({ type: 'jpeg', quality: 65, fullPage: false, mask: [page.locator('input[type=password],input[autocomplete*=cc-],input[autocomplete=one-time-code]')] }) }
    const element = this.refs.get(args.tab)?.get(args.ref)
    if (!element) throw new Error('Read this page first, then use a current element reference')
    if (action === 'click') await element.click()
    else if (action === 'type') {
      const secret = await element.evaluate(el => el.type === 'password' || /cc-|one-time-code/.test(el.autocomplete ?? ''))
      if (secret) throw new Error('Enter passwords, payment details and verification codes yourself')
      if (typeof args.text !== 'string' || args.text.length > 12000) throw new Error('Text must be at most 12000 characters')
      await element.fill(args.text)
    } else throw new Error('Unknown browser action')
    await this.invalidate(args.tab)
    return { tab: args.tab, url: page.url(), next: 'Read again after the action; previous references have expired.' }
  }
  async shutdown() { await this.context?.close(); this.context = null }
}
