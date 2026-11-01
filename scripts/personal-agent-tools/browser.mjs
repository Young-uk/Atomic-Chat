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

export class PersonalBrowser {
  constructor(directory, chromiumLoader = async () => (await import('playwright-core')).chromium) {
    this.directory = directory
    this.loadChromium = chromiumLoader
    this.tabs = new Map()
    this.nextTab = 1
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
      const handles = await page.locator('a,button,input,textarea,select,[role="button"],[role="link"]').elementHandles()
      const refs = new Map()
      const elements = []
      for (const handle of handles.slice(200)) await handle.dispose()
      for (const handle of handles.slice(0, 200)) {
        const info = await handle.evaluate(el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || '').slice(0, 150), visible: Boolean(el.getClientRects().length) })).catch(() => null)
        if (!info?.visible || ['password', 'hidden'].includes(info.type)) { await handle.dispose(); continue }
        const ref = `e${elements.length + 1}`
        refs.set(ref, handle)
        elements.push({ ref, ...info })
      }
      await this.invalidate(args.tab)
      this.refs.set(args.tab, refs)
      return { untrustedPageContent: true, tab: args.tab, url: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 16000), elements }
    }
    if (action === 'scroll') {
      await this.invalidate(args.tab)
      await page.mouse.wheel(0, args.direction === 'up' ? -600 : 600)
      return { tab: args.tab, next: 'Read the page again.' }
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
