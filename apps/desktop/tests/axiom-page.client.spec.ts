// @vitest-environment jsdom
/** Original message DOM is projected without actions, hidden content, or active media. */
import { runInNewContext } from 'node:vm'
import type { AxiomHistoryObservation } from '../src/axiom-page.ts'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { clickAxiomSend, findAxiomAcknowledgement, focusAxiomComposer, readAxiomHistoryPage, readAxiomPage } from '../src/axiom-page.ts'

const nativeInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
beforeAll(() => {
  // jsdom has no layout-backed innerText; this fixture's editable/status elements contain plain text.
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true,
    get(this: HTMLElement) { return this.textContent }, set(this: HTMLElement, value: string) { this.textContent = value },
  })
})
afterAll(() => {
  if (nativeInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', nativeInnerText)
  else Reflect.deleteProperty(HTMLElement.prototype, 'innerText')
})

function fixture(): void {
  document.title = 'Axiom'
  document.body.innerHTML = `
    <article class="message-row self" data-message-id="original/user~1">
      <div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"><p>Exact user text</p></div></div></div>
      <div class="message-inline-actions" aria-label="Message actions">Copy PRIVATE_ACTION</div></div><time datetime="2026-11-12T10:00:00Z"></time>
    </article>
    <article class="message-row" data-message-id="original/assistant~2">
      <div class="quoted-reply">EXCLUDE_QUOTE</div>
      <div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"><p>Hello <strong>world</strong> <a href="https://example.com/reference">reference</a></p><pre><code>const value = 1;</code></pre><ul><li>First</li><li>Second</li></ul><img src="https://example.com/never-fetch" alt="Image omitted"><span hidden>PRIVATE_HIDDEN</span><script>PRIVATE_SCRIPT</script></div></div></div></div>
    </article>
    <div role="textbox" contenteditable="true" aria-label="Message" class="ProseMirror"></div>
    <button aria-label="Send" disabled>Send</button>
    <div role="status" class="typing-indicator" aria-live="polite">Reconnecting…</div>`
}

it.each(['visibility: hidden', 'display: none'])('keeps a %s history cursor without exposing its hidden body', (style) => {
  fixture()
  const scroller = document.createElement('section')
  scroller.className = 'messages-scroll'
  const list = document.createElement('div')
  list.className = 'message-list'
  list.append(...document.querySelectorAll('article.message-row'))
  scroller.append(list)
  document.body.prepend(scroller)
  const cursor = list.querySelector<HTMLElement>('[data-message-id="original/assistant~2"]')!
  cursor.setAttribute('style', style)
  expect(readAxiomPage().sourceOrder).toEqual(['original/user~1', 'original/assistant~2'])
  expect(readAxiomPage().messages.map(message => message.id)).toEqual(['original/user~1'])
  const prior = readAxiomPage('original/assistant~2')
  expect(prior.messages.map(message => message.id)).toEqual(['original/user~1'])
  expect(prior.sourceOrder).toEqual(['original/user~1'])
  const history = readAxiomHistoryPage(readAxiomPage, location.href.replace(/\/$/u, ''), 'original/assistant~2', false)
  expect(history.anchorFound).toBe(true)
  expect(history.messages).toEqual(prior.messages)
  expect(history.messages.some(message => message.text.includes('world'))).toBe(false)
})

describe('original Dot DOM projection', () => {
  it('keeps source roles, IDs, Markdown and observed status without hidden data or image URLs', () => {
    fixture()
    const state = readAxiomPage()
    expect(state.title).toBe('Axiom')
    expect(state.messages[0]).toMatchObject({ id: 'original/user~1', role: 'user', timestamp: '2026-11-12T10:00:00Z' })
    expect(state.messages[1]?.text).toContain('**world**')
    expect(state.messages[1]?.text).toContain('[reference](https://example.com/reference)')
    expect(state.messages[1]?.text).toContain('```\nconst value = 1;\n```')
    expect(state.messages[1]?.text).toContain('- First\n- Second')
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE_|EXCLUDE_QUOTE|never-fetch/)
    expect(state.siteStatus).toBe('Reconnecting…')
    expect(state.sendPresent).toBe(true)
    expect(state.sendEnabled).toBe(false)
  })

  it('requires an empty real composer and exact inserted text before clicking the actual enabled button', () => {
    fixture()
    expect(focusAxiomComposer()).toBe(true)
    const composer = document.querySelector('[role="textbox"]') as HTMLElement
    composer.innerText = 'Exact new text'
    expect(focusAxiomComposer()).toBe(false)
    expect(clickAxiomSend('Different text')).toBe(false)
    expect(clickAxiomSend('Exact new text')).toBe(false)
    const button = document.querySelector('button') as HTMLButtonElement
    button.disabled = false
    expect(clickAxiomSend('Exact new text')).toBe(true)
    expect(findAxiomAcknowledgement('Exact user text', ['original/user~1'])).toBeNull()
    expect(findAxiomAcknowledgement('Exact user text', [])).toBe('original/user~1')
  })

  it('acknowledges a new source user body when background layout has no innerText', () => {
    fixture()
    const body = document.querySelector('article.self .message-text') as HTMLElement
    Object.defineProperty(body, 'innerText', { configurable: true, get: () => '' })
    expect(findAxiomAcknowledgement('Exact user text', [])).toBe('original/user~1')
    expect(findAxiomAcknowledgement('Exact user text', ['original/user~1'])).toBeNull()
    expect(findAxiomAcknowledgement('Different text', [])).toBeNull()
  })

  it('retains the newest user and reply when older rendered bodies exceed the text budget', () => {
    const bodies = [...Array.from({ length: 5 }, () => 'a'.repeat(32768)), 'Exact new text', 'Newest original reply']
    document.body.replaceChildren(...bodies.map((text, index) => {
      const row = document.createElement('article')
      row.className = index === 5 ? 'message-row self' : 'message-row'
      row.dataset.messageId = `original/${index}`
      row.innerHTML = '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"></div></div></div></div>'
      row.querySelector('.message-text')!.textContent = text
      return row
    }))
    const state = readAxiomPage()
    expect(state.messages.map(message => message.id)).toEqual([1, 2, 3, 4, 5, 6].map(index => `original/${index}`))
    expect(state.messages.slice(-2)).toMatchObject([
      { id: 'original/5', role: 'user', text: 'Exact new text', truncated: false },
      { id: 'original/6', role: 'assistant', text: 'Newest original reply', truncated: false },
    ])
    expect(state.messages[0]?.truncated).toBe(true)
    expect(state.messages.every(message => message.text.length <= 32768)).toBe(true)
    expect(state.messages.reduce((size, message) => size + message.text.length, 0)).toBe(131072)
    expect(state.limited).toBe(true)
  })
})

it('reads every original message across chronological bounded pages without a total-message ceiling', () => {
  document.body.innerHTML = '<section class="messages-scroll"><div class="message-list"></div></section>'
  const list = document.querySelector('.message-list')!
  for (let index = 0; index < 288; index++) {
    const row = document.createElement('article')
    row.className = index % 2 === 0 ? 'message-row self' : 'message-row'
    row.dataset.messageId = `original/${index}`
    row.innerHTML = '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"></div></div></div></div>'
    row.querySelector('.message-text')!.textContent = `Observed original ${index}`
    list.append(row)
  }
  let messages = [...readAxiomPage().messages]
  expect(messages).toHaveLength(100)
  expect(readAxiomPage().sourceOrder).toHaveLength(100)
  const pageUrl = location.href.replace(/\/$/u, '')
  for (let count = 0; count < 2; count++) {
    const older = readAxiomHistoryPage(readAxiomPage, pageUrl, messages[0]!.id, false)
    expect(older.supported).toBe(true)
    expect(older.anchorFound).toBe(true)
    expect(older.messages.length).toBeLessThanOrEqual(100)
    messages = [...older.messages, ...messages]
  }
  expect(messages.map(message => message.id)).toEqual(Array.from({ length: 288 }, (_, index) => `original/${index}`))
  const top = readAxiomHistoryPage(readAxiomPage, pageUrl, messages[0]!.id, true)
  expect(top.messages).toEqual([])
  expect(top.startVerified).toBe(false)
  expect(readAxiomHistoryPage(readAxiomPage, 'https://chatgpt.com/dots/wrong', messages[0]!.id, true).supported).toBe(false)
})

it('keeps own-row timestamps and source IDs while excluding quoted or nested message clones', () => {
  fixture()
  const user = document.querySelector('article.self')!
  const quote = document.createElement('div')
  quote.className = 'quoted-reply'
  quote.innerHTML = '<article class="message-row" data-message-id="quoted-clone"><time datetime="2000-01-01T00:00:00Z"></time><div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text">Quoted duplicate</div></div></div></div></article>'
  user.prepend(quote)
  document.body.append(user.cloneNode(true))
  const state = readAxiomPage()
  expect(state.messages.map(message => message.id)).toEqual(['original/user~1', 'original/assistant~2'])
  expect(state.messages[0]?.timestamp).toBe('2026-11-12T10:00:00Z')
  const composer = document.querySelector('[role="textbox"]')!
  Object.defineProperty(composer, 'innerText', { configurable: true, get: () => { throw new Error('History must not inspect drafts') } })
  expect(readAxiomPage('original/assistant~2').messages.map(message => message.id)).toEqual(['original/user~1'])
})


it.each(['a1b5c831-09f4-4fdd-9660-05ec402ff83e', 'A1B5C831-09F4-4FDD-9660-05EC402FF83E'])(
  'waits for a committed source ID instead of retaining or acknowledging temporary row %s', (temporaryId) => {
    fixture()
    const user = document.querySelector('article.self')!
    const committedId = 'a1b5c831-09f4-4fdd-9660-05ec402ff83e~CalpicoMessage~Sentinel_committed'
    user.setAttribute('data-message-id', temporaryId)
    expect(readAxiomPage().messages.map(message => message.id)).toEqual(['original/assistant~2'])
    expect(findAxiomAcknowledgement('Exact user text', [])).toBeNull()

    user.setAttribute('data-message-id', committedId)
    expect(readAxiomPage().messages.map(message => message.id)).toEqual([committedId, 'original/assistant~2'])
    expect(findAxiomAcknowledgement('Exact user text', [])).toBe(committedId)

    const repeated = user.cloneNode(true) as HTMLElement
    const repeatedId = 'another-source~CalpicoMessage~Sentinel_repeated'
    repeated.setAttribute('data-message-id', repeatedId)
    document.body.append(repeated)
    expect(readAxiomPage().messages.filter(message => message.role === 'user').map(message => message.id))
      .toEqual([committedId, repeatedId])
    expect(findAxiomAcknowledgement('Exact user text', [committedId])).toBe(repeatedId)
  },
)

it('excludes temporary website rows from older pages and original history cursors', () => {
  fixture()
  const scroller = document.createElement('section')
  scroller.className = 'messages-scroll'
  const list = document.createElement('div')
  list.className = 'message-list'
  list.append(...document.querySelectorAll('article.message-row'))
  scroller.append(list)
  document.body.prepend(scroller)
  const user = list.querySelector('article.self')!
  const temporaryId = 'a1b5c831-09f4-4fdd-9660-05ec402ff83e'
  user.setAttribute('data-message-id', temporaryId)
  const url = location.href.replace(/\/$/u, '')
  expect(readAxiomHistoryPage(readAxiomPage, url, temporaryId, false).anchorFound).toBe(false)
  expect(readAxiomHistoryPage(readAxiomPage, url, 'original/assistant~2', false))
    .toMatchObject({ anchorFound: true, messages: [], hasEarlier: false, startVerified: false })

  const committedId = 'source~CalpicoMessage~Sentinel_committed'
  user.setAttribute('data-message-id', committedId)
  expect(readAxiomHistoryPage(readAxiomPage, url, 'original/assistant~2', false).messages.map(message => message.id))
    .toEqual([committedId])
})


it('retains exact bounded source row order before temporarily missing bodies are skipped', () => {
  document.body.innerHTML = '<section class="messages-scroll"><div class="message-list"></div></section>'
  const list = document.querySelector('.message-list')!
  for (const id of ['a', 'b', 'c', 'd']) {
    const row = document.createElement('article')
    row.className = 'message-row'
    row.dataset.messageId = id
    row.innerHTML = '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"></div></div></div></div>'
    row.querySelector('.message-text')!.textContent = id
    list.append(row)
  }
  const b = list.querySelector('[data-message-id="b"] .message-body')!
  const c = list.querySelector('[data-message-id="c"] .message-body')!
  b.remove(); c.remove()
  expect(readAxiomPage().messages.map(message => message.id)).toEqual(['a', 'd'])
  expect(readAxiomPage().sourceOrder).toEqual(['a', 'b', 'c', 'd'])
  list.querySelector('[data-message-id="b"]')!.append(b)
  list.querySelector('[data-message-id="c"]')!.append(c)
  list.querySelector('[data-message-id="d"] .message-body')!.remove()
  expect(readAxiomPage().messages.map(message => message.id)).toEqual(['a', 'b', 'c'])
  expect(readAxiomPage().sourceOrder).toEqual(['a', 'b', 'c', 'd'])
  const earlier = readAxiomHistoryPage(readAxiomPage, location.href.replace(/\/$/u, ''), 'd', false)
  expect(earlier.sourceOrder).toEqual(['a', 'b', 'c'])
})


it('proposes validated native wheel geometry without scrolling or focusing, then reads the source-prepended body', () => {
  document.body.innerHTML = '<div id="primary-scroll"></div><input aria-label="Keep focus">'
    + '<section class="messages-scroll"><div class="message-list">'
    + '<article class="message-row" data-message-id="committed~CalpicoMessage~Sentinel_cursor">'
    + '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text">Latest body</div>'
    + '</div></div></div></article></div></section>'
    + '<div role="textbox" contenteditable="true" aria-label="Message">Preserved draft</div>'
  const primary = document.querySelector('#primary-scroll')!
  primary.scrollTop = 77
  const focused = document.querySelector('input')!
  focused.focus()
  const composer = document.querySelector('[role="textbox"]')!
  Object.defineProperty(composer, 'innerText', { get: () => { throw new Error('History must not read the live draft') } })
  const scroller = document.querySelector('.messages-scroll')!
  const list = scroller.querySelector('.message-list')!
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 })
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(scroller, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(10, 20, 600, 500) })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => list })
  scroller.scrollTop = 250
  scroller.addEventListener('wheel', (event) => {
    if (!(event instanceof WheelEvent) || event.deltaY >= 0 || list.children.length > 1) return
    scroller.scrollTop = Math.max(0, scroller.scrollTop + event.deltaY)
    list.insertAdjacentHTML('afterbegin', '<article class="message-row self" data-message-id="committed~CalpicoMessage~Sentinel_older">'
      + '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text">Older source body</div>'
      + '</div></div></div></article>')
  })
  const observe = (): AxiomHistoryObservation => {
    const script = `(${readAxiomHistoryPage.toString()})(${readAxiomPage.toString()},${JSON.stringify(location.href.replace(/\/$/u, ''))},"committed~CalpicoMessage~Sentinel_cursor",true)`
    const value: unknown = runInNewContext(script, { document, location, Node, HTMLElement, HTMLButtonElement, getComputedStyle, URL })
    return value as AxiomHistoryObservation
  }
  try {
    const observed = observe()
    expect(observed.messages).toEqual([])
    expect(observed.wheel).toEqual({ x: 310, y: 270, deltaY: 400, viewportWidth: 800, viewportHeight: 600 })
    expect(scroller.scrollTop).toBe(250)
    // Electron's positive upward wheel delta becomes a negative DOM WheelEvent delta.
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -observed.wheel!.deltaY }))
    const older = observe()
    expect(older.messages).toMatchObject([{ id: 'committed~CalpicoMessage~Sentinel_older', role: 'user', text: 'Older source body' }])
    expect(older.sourceOrder).toEqual(['committed~CalpicoMessage~Sentinel_older'])
    expect(primary.scrollTop).toBe(77)
    expect(document.activeElement).toBe(focused)
    expect(composer.textContent).toBe('Preserved draft')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => composer })
    expect(observe().wheel).toBeUndefined()
    Object.defineProperty(scroller, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(900, 0, 20, 20) })
    expect(observe().wheel).toBeUndefined()
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 500 })
    expect(observe().wheel).toBeUndefined()
  } finally {
    Reflect.deleteProperty(document, 'elementFromPoint')
    Reflect.deleteProperty(document.documentElement, 'clientWidth')
    Reflect.deleteProperty(document.documentElement, 'clientHeight')
  }
})
