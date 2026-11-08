import { clearFindHighlight } from '../scoped-find'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationFindMatches, registerConversationFind } from '../conversation-find'

afterEach(() => { clearFindHighlight(); document.body.replaceChildren() })

describe('conversation source find', () => {
  it('finds every literal occurrence, including content absent from the DOM', () => {
    const root = document.createElement('div')
    document.body.append(root)
    registerConversationFind(root, [
      { id: 'old', parts: [{ type: 'text', text: 'Needle in an old message' }] },
      { id: 'new', parts: [{ type: 'text', text: '```\nneedle Needle\n```' }] },
    ])
    const results = conversationFindMatches(root, 'needle')!
    expect(results).toHaveLength(3)
    expect(results.map(result => result.text.slice(result.start, result.end)))
      .toEqual(['Needle', 'needle', 'Needle'])
    expect(root.textContent).toBe('')
    expect(conversationFindMatches(root, '```')).toHaveLength(2)
    expect(conversationFindMatches(root, '[')).toHaveLength(0)
  })

  it('searches text/reasoning but never tool arguments', () => {
    const root = document.createElement('div')
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'reasoning', text: 'find me' },
      { type: 'text', text: 'find me too' },
      { type: 'tool-secret', text: 'find me never' },
    ] }])
    expect(conversationFindMatches(root, 'find')).toHaveLength(2)
    expect(conversationFindMatches(root, '')).toEqual([])
  })

  it('uses rendered bodies for phrases spanning inline markdown without duplicates', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><p data-atomic-find-rendered-text>hello <strong>world</strong></p></div><div data-atomic-find-message="b"><p data-atomic-find-rendered-text>hello world</p></div>'
    registerConversationFind(root, [
      { id: 'a', parts: [{ type: 'text', text: 'hello **world**' }] },
      { id: 'b', parts: [{ type: 'text', text: 'hello world' }] },
    ])
    const results = conversationFindMatches(root, 'hello world')!
    expect(results).toHaveLength(2)
    expect(results.map(result => result.label)).toEqual(['Rendered message', 'Rendered message'])
    results[0].reveal()
    expect(window.getSelection()?.toString()).not.toBe('hello world')
    expect(conversationFindMatches(root, 'world')).toHaveLength(2)
  })

  it('does not assign duplicate rendered blocks to the first identical source part', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><p data-atomic-find-rendered-text>hello world</p><p data-atomic-find-rendered-text>hello world</p></div>'
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'text', text: 'hello world' },
      { type: 'text', text: 'hello world' },
    ] }])
    const results = conversationFindMatches(root, 'hello world')!
    expect(results).toHaveLength(2)
    expect(results.map(result => result.label)).toEqual(['Rendered message', 'Rendered message'])
  })

  it.each([false, true])('finds repeated formatted parts with hidden reasoning=%s', (withReasoning) => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><p data-atomic-find-rendered-text>hello <strong>world</strong></p><p data-atomic-find-rendered-text>hello <strong>world</strong></p></div>'
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'text', text: 'hello **world**' },
      { type: 'text', text: 'hello **world**' },
      ...(withReasoning ? [{ type: 'reasoning', text: 'separate hello world reasoning' }] : []),
    ] }])
    const results = conversationFindMatches(root, 'hello world')!
    expect(results).toHaveLength(withReasoning ? 3 : 2)
    expect(results.filter(result => result.label === 'Rendered message')).toHaveLength(2)
  })

  it('counts repeated mixed-markup bodies and unrelated visible labels without source duplicates', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><p data-atomic-find-rendered-text>hello world; hello <strong>world</strong></p><p data-atomic-find-rendered-text>hello world; hello <strong>world</strong></p><p data-atomic-find-rendered-text>unassociated hello world label</p></div>'
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'text', text: 'hello world; hello **world**' },
      { type: 'text', text: 'hello world; hello **world**' },
      { type: 'reasoning', text: 'hidden hello world thought' },
    ] }])
    const results = conversationFindMatches(root, 'hello world')!
    expect(results).toHaveLength(6)
    expect(results.filter(result => result.label === 'Rendered message')).toHaveLength(5)
    expect(results.filter(result => result.label === 'Reasoning')).toHaveLength(1)
  })

  it('counts plain and emphasized phrases in one part while retaining collapsed reasoning', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><p data-atomic-find-rendered-text>hello world; hello <strong>world</strong></p></div>'
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'text', text: 'hello world; hello **world**' },
      { type: 'reasoning', text: 'hidden hello world' },
    ] }])
    const results = conversationFindMatches(root, 'hello world')!
    expect(results).toHaveLength(3)
    expect(results.map(result => result.label).sort()).toEqual(['Reasoning', 'Rendered message', 'Rendered message'])
    expect(conversationFindMatches(root, 'world')).toHaveLength(3)
  })

  it('counts mixed raw and link-formatted phrases exactly once per visible occurrence', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><div data-atomic-find-rendered-text><p>hello world; hello <a href="https://example.com/hello-world">world</a></p></div></div>'
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'text', text: 'hello world; hello [world](https://example.com/hello-world)' },
    ] }])
    expect(conversationFindMatches(root, 'hello world')).toHaveLength(2)
    expect(conversationFindMatches(root, 'https://example.com')).toHaveLength(0)
  })

  it('falls back to source when the marked message body is not rendered', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><div data-atomic-find-rendered-text hidden>hidden needle</div></div>'
    registerConversationFind(root, [{ id: 'a', parts: [{ type: 'text', text: 'hidden needle' }] }])
    const results = conversationFindMatches(root, 'needle')!
    expect(results).toHaveLength(1)
    expect(results[0].label).toBe('Assistant message')
  })

  it('searches current inline editor text without searching or mutating the saved prose', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><div data-atomic-find-rendered-text><textarea></textarea></div></div>'
    const editor = root.querySelector('textarea')!
    editor.value = 'new unsaved draft'
    registerConversationFind(root, [{ id: 'a', parts: [{ type: 'text', text: 'old saved prose' }] }])
    expect(conversationFindMatches(root, 'old')).toHaveLength(0)
    expect(conversationFindMatches(root, 'new')).toHaveLength(1)
    expect(editor.value).toBe('new unsaved draft')
  })

  it('finds collapsed display-text tool results without indexing hidden credentials', () => {
    const root = document.createElement('div')
    registerConversationFind(root, [{ id: 'a', parts: [
      { type: 'tool-os.shell.run', output: { text: 'terminal needle', apiKey: 'private sentinel', metadata: { text: 'private sentinel' } } },
      { type: 'tool-read', output: { content: [{ type: 'text', text: 'document needle' }, { type: 'image', data: 'private sentinel', text: 'private sentinel' }] } },
      { type: 'tool-web', output: { results: [{ title: 'needle title', highlights: ['needle excerpt'], auth: { text: 'private sentinel' } }] } },
      { type: 'tool-failed', errorText: 'needle failure' },
    ] }])
    expect(conversationFindMatches(root, 'needle')).toHaveLength(5)
    expect(conversationFindMatches(root, 'private sentinel')).toHaveLength(0)
  })

  it('mounts an offscreen message by identity before resolving its actual text', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const reveal = vi.fn((id: string) => {
      const anchor = document.createElement('div')
      anchor.dataset.atomicFindMessage = id
      anchor.innerHTML = '<p data-atomic-find-rendered-text>Hidden needle</p>'
      root.append(anchor)
    })
    registerConversationFind(root, [{ id: 'a"] tricky id', parts: [{ type: 'text', text: 'Hidden needle' }] }], reveal)
    const match = conversationFindMatches(root, 'needle')![0]
    const cancel = match.reveal()
    expect(reveal).toHaveBeenCalledWith('a"] tricky id')
    expect(match.target?.()?.toString()).toBe('needle')
    cancel?.()
  })

  it('reveals collapsed reasoning and the selected repeated occurrence without clicking actions', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><div data-atomic-find-reasoning data-state="closed"><div data-reasoning-viewport hidden>needle first needle second</div></div><button>Retry</button></div>'
    const reasoning = root.querySelector<HTMLElement>('[data-atomic-find-reasoning]')!
    reasoning.addEventListener('atomic-find-reveal', () => {
      reasoning.dataset.state = 'open'
      root.querySelector<HTMLElement>('[data-reasoning-viewport]')!.hidden = false
    })
    const click = vi.fn()
    root.querySelector('button')!.onclick = click
    registerConversationFind(root, [{ id: 'a', parts: [{ type: 'reasoning', text: 'needle first needle second' }] }])
    const match = conversationFindMatches(root, 'needle')![1]
    const cancel = match.reveal()
    const target = match.target?.() as Range
    expect(target.toString()).toBe('needle')
    expect(target.startOffset).toBe(13)
    expect(reasoning.dataset.state).toBe('open')
    expect(click).not.toHaveBeenCalled()
    cancel?.()
  })

  it('opens only the matching tool disclosure and excludes its input from targets', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.innerHTML = '<div data-atomic-find-message="a"><div data-testid="tool-activity-group" data-state="closed"><div data-atomic-find-tool="a-0" data-state="closed"><div data-atomic-find-tool-content hidden><div data-atomic-find-tool-input>needle secret input</div><p>needle result needle result</p></div></div></div></div>'
    for (const element of root.querySelectorAll<HTMLElement>('[data-state]')) element.addEventListener('atomic-find-reveal', () => {
      element.dataset.state = 'open'
      element.querySelector<HTMLElement>('[data-atomic-find-tool-content]')!.hidden = false
    })
    registerConversationFind(root, [{ id: 'a', parts: [{ type: 'tool-read', output: { text: 'needle result needle result' } }] }])
    const match = conversationFindMatches(root, 'needle')![1]
    const cancel = match.reveal()
    const target = match.target?.() as Range
    expect(target.toString()).toBe('needle')
    expect(target.startOffset).toBe(14)
    expect(target.startContainer.parentElement?.tagName).toBe('P')
    cancel?.()
  })

  it('keeps Unicode match offsets aligned with the original source', () => {
    const root = document.createElement('div')
    registerConversationFind(root, [{ id: 'a', parts: [{ type: 'text', text: 'İ emoji 😀 검색 검색' }] }])
    const results = conversationFindMatches(root, '검색')!
    expect(results).toHaveLength(2)
    expect(results.map(result => result.text.slice(result.start, result.end))).toEqual(['검색', '검색'])
  })

  it('removes stale registrations without erasing newer data', () => {
    const page = document.createElement('main')
    const root = document.createElement('div')
    page.append(root)
    const changed = vi.fn()
    document.addEventListener('atomic-find-update', changed)
    const oldCleanup = registerConversationFind(root, [{ id: 'old', parts: [{ type: 'text', text: 'old' }] }])
    const cleanup = registerConversationFind(root, [{ id: 'new', parts: [{ type: 'text', text: 'new' }] }])
    oldCleanup()
    expect(conversationFindMatches(page, 'new')).toHaveLength(1)
    expect(conversationFindMatches(page, 'old')).toHaveLength(0)
    cleanup()
    expect(conversationFindMatches(page, 'new')).toBeNull()
    expect(changed).toHaveBeenCalledTimes(3)
    document.removeEventListener('atomic-find-update', changed)
  })
})
