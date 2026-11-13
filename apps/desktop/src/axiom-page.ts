/** DOM operations limited to the observed ChatGPT Dot message and composer elements. */
import type { AxiomMessage } from './axiom-protocol.ts'

/** DOM-only snapshot returned from the isolated original page. */
export interface AxiomPageState {
  readonly url: string
  readonly title: string
  readonly messages: readonly AxiomMessage[]
  readonly sourceOrder?: readonly string[]
  readonly composer: boolean
  readonly draft: string
  readonly sendPresent: boolean
  readonly sendEnabled: boolean
  readonly siteStatus: string | null
  readonly limited: boolean
}

/**
 * Read committed message bodies without page storage, application state, or network interception.
 * This function is serialized into the original page and therefore has no module references.
 * @param beforeId Optional original cursor; a history read returns only preceding messages and never reads the composer.
 * @returns Original-page text in source order, retaining the newest messages within the bounds, and observed composer state.
 */
export function readAxiomPage(beforeId?: string): AxiomPageState {
  // The website replaces optimistic bare UUIDv4 rows with committed compound source IDs.
  const temporaryId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  const seen = new Set<string>()
  // CSS virtualization must not remove a cursor; hidden bodies remain excluded below.
  const rows = [...document.querySelectorAll('article.message-row[data-message-id]')].filter((row) => {
    const id = row.getAttribute('data-message-id')
    if (!id || id.length > 512 || temporaryId.test(id) || seen.has(id) || row.parentElement?.closest('article.message-row[data-message-id]')
      || row.closest('.quoted-reply,blockquote,[hidden],[aria-hidden="true"]')) return false
    seen.add(id)
    return true
  })
  const cursor = beforeId === undefined ? rows.length : rows.findIndex(row => row.getAttribute('data-message-id') === beforeId)
  const preceding = cursor < 0 ? [] : rows.slice(0, cursor)
  const sourceOrder = preceding.slice(-100).flatMap((row) => {
    const id = row.getAttribute('data-message-id')
    return id === null ? [] : [id]
  })
  const messages: AxiomMessage[] = []
  let remaining = 131072
  let limited = preceding.length > 100
  for (const row of preceding.slice(-100).reverse()) {
    const style = getComputedStyle(row)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const id = row.getAttribute('data-message-id')
    const body = [...row.querySelectorAll('.message-body > .message-surface .message-bubble .message-text')]
      .find(candidate => candidate.closest('article.message-row[data-message-id]') === row
        && !candidate.closest('.quoted-reply,blockquote,[hidden],[aria-hidden="true"]'))
    if (id === null || id.length > 512 || body === undefined) continue
    const escape = (text: string): string => text.replaceAll(/([\\`*_[\]<>|~])/gu, '\\$1')
    const serialize = (node: Node, depth = 0): string => {
      if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '')
      if (!(node instanceof HTMLElement)) return ''
      if (node.matches('script,style,button,.message-inline-actions,.quoted-reply,article.message-row,[hidden],[aria-hidden="true"]')) return ''
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return ''
      const children = (): string => [...node.childNodes].map(child => serialize(child, depth)).join('')
      const tag = node.tagName
      if (tag === 'BR') return '\n'
      if (tag === 'IMG') return escape(node.getAttribute('alt') ?? '')
      if (tag === 'PRE') {
        const code = node.querySelector('code')?.textContent ?? node.textContent
        const runs = code.match(/`+/gu) ?? []
        const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)))
        return `\n${fence}\n${code}\n${fence}\n`
      }
      if (tag === 'CODE') {
        const text = node.textContent
        const fence = '`'.repeat(Math.max(1, ...(text.match(/`+/gu) ?? []).map(run => run.length + 1)))
        return `${fence} ${text} ${fence}`
      }
      if (tag === 'A') {
        const text = children()
        try {
          const url = new URL(node.getAttribute('href') ?? '', location.href)
          if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            return `[${text}](${url.href.replaceAll('(', '%28').replaceAll(')', '%29')})`
          }
        } catch (_invalidLink) { /* Invalid authored links retain only their visible label. */ }
        return text
      }
      if (tag === 'STRONG' || tag === 'B') return `**${children()}**`
      if (tag === 'EM' || tag === 'I') return `*${children()}*`
      if (tag === 'DEL' || tag === 'S') return `~~${children()}~~`
      if (tag === 'UL' || tag === 'OL') {
        return '\n' + [...node.children].filter(child => child.tagName === 'LI').map((child, index) => {
          const text = [...child.childNodes].map(item => serialize(item, depth + 1)).join('').trim()
          const prefix = tag === 'OL' ? `${index + 1}. ` : '- '
          return `${'  '.repeat(depth)}${prefix}${text}`
        }).join('\n') + '\n'
      }
      if (tag === 'TABLE') {
        const lines = [...node.querySelectorAll('tr')].map(row =>
          '| ' + [...row.children].filter(cell => ['TH', 'TD'].includes(cell.tagName))
            .map(cell => serialize(cell, depth).trim().replaceAll('\n', ' ')).join(' | ') + ' |')
        if (lines.length > 0) {
          const count = node.querySelector('tr')?.children.length ?? 1
          lines.splice(1, 0, '| ' + Array.from({ length: count }, () => '---').join(' | ') + ' |')
        }
        return '\n' + lines.join('\n') + '\n'
      }
      if (tag === 'BLOCKQUOTE') return '\n' + children().trim().split('\n').map(line => `> ${line}`).join('\n') + '\n'
      if (/^H[1-6]$/u.test(tag)) return `\n${'#'.repeat(Number(tag[1]))} ${children().trim()}\n`
      return /^(?:P|DIV|LI)$/u.test(tag) ? children() + '\n\n' : children()
    }
    const full = serialize(body).trim()
    const size = Math.min(32768, remaining)
    const text = full.slice(0, size)
    const truncated = text.length !== full.length
    limited ||= truncated
    remaining -= text.length
    if (text !== '') messages.push({ id, role: row.classList.contains('self') ? 'user' : 'assistant', text,
      timestamp: [...row.querySelectorAll('time')].find(time => time.closest('article.message-row[data-message-id]') === row
        && !time.closest('.quoted-reply,blockquote'))?.getAttribute('datetime')?.slice(0, 100) ?? null, truncated })
  }
  messages.reverse()
  const composer = beforeId === undefined
    ? document.querySelector('div[role="textbox"][contenteditable="true"][aria-label="Message"]') : null
  const send = beforeId === undefined ? document.querySelector('button[aria-label="Send"]') : null
  const status = document.querySelector('[role="status"].typing-indicator[aria-live="polite"]')
  return {
    url: location.href, title: document.title.slice(0, 300), messages, sourceOrder,
    composer: composer instanceof HTMLElement && composer.getAttribute('aria-disabled') !== 'true',
    draft: composer instanceof HTMLElement ? composer.innerText.slice(0, 131073) : '',
    sendPresent: send instanceof HTMLButtonElement,
    sendEnabled: send instanceof HTMLButtonElement && !send.disabled,
    siteStatus: status instanceof HTMLElement ? status.innerText.trim().slice(0, 500) || null : null,
    limited,
  }
}

/**
 * Focus only the observed empty real composer; caller inserts text through native WebContents input.
 * @returns Whether the original composer is available and empty.
 */
export function focusAxiomComposer(): boolean {
  const composer = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label="Message"]')
  if (!(composer instanceof HTMLElement) || composer.innerText.trim() !== '' || composer.getAttribute('aria-disabled') === 'true') return false
  composer.focus({ preventScroll: true })
  return document.activeElement === composer
}

/**
 * Submit exactly the inserted draft through the observed original Send button.
 * @param text Exact user-composed text, serialized as data rather than executable code.
 * @returns Whether the real page's enabled control was clicked; no alternate submission is attempted.
 */
export function clickAxiomSend(text: string): boolean {
  const composer = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label="Message"]')
  const send = document.querySelector('button[aria-label="Send"]')
  if (!(composer instanceof HTMLElement) || composer.innerText.replaceAll('\r\n', '\n') !== text
    || !(send instanceof HTMLButtonElement) || send.disabled) return false
  send.click()
  return true
}

/**
 * Find original-page acknowledgement after one click, including when background layout skips its text.
 * @param text Exact submitted user text.
 * @param before IDs present immediately before submission.
 * @returns The committed ID of a new matching user message, excluding temporary UUIDv4 rows, or null.
 */
export function findAxiomAcknowledgement(text: string, before: readonly string[]): string | null {
  const temporaryId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  for (const row of document.querySelectorAll('article.message-row.self[data-message-id]')) {
    const id = row.getAttribute('data-message-id')
    const body = row.querySelector('.message-body > .message-surface .message-bubble .message-text')
    if (id !== null && !temporaryId.test(id) && id.length <= 512 && !before.includes(id) && body instanceof HTMLElement
      && (body.textContent.replaceAll('\r\n', '\n').trim() === text.trim()
        || body.innerText.replaceAll('\r\n', '\n').trim() === text.trim())) return id
  }
  return null
}

/** One bounded original history observation; absence of a start marker never means exhaustion. */
export interface AxiomHistoryObservation {
  readonly url: string
  readonly supported: boolean
  readonly anchorFound: boolean
  /** A bounded source-scroller wheel proposal; only its native owner may dispatch it after revalidation. */
  readonly wheel?: {
    readonly x: number
    readonly y: number
    readonly deltaY: number
    readonly viewportWidth: number
    readonly viewportHeight: number
  }
  readonly messages: readonly AxiomMessage[]
  readonly sourceOrder?: readonly string[]
  readonly hasEarlier: boolean
  readonly startVerified: boolean
}

/**
 * Observe earlier original rows and propose bounded native scrolling through the site's own scroll container.
 * @param read Shared sanitized reader, serialized alongside this function.
 * @param url Exact selected canonical Dot; other documents are never read or scrolled.
 * @param beforeId Stable original message cursor.
 * @param scroll Whether to propose an upward native wheel event for the separately owned history page.
 * @returns A bounded chronological page and explicit source-boundary evidence.
 */
export function readAxiomHistoryPage(
  read: (beforeId?: string) => AxiomPageState, url: string, beforeId: string, scroll: boolean,
): AxiomHistoryObservation {
  const empty: AxiomHistoryObservation = { url, supported: false, anchorFound: false, messages: [],
    hasEarlier: false, startVerified: false }
  if (location.href.replace(/\/$/u, '') !== url) return empty
  const scroller = document.querySelector('.messages-scroll')
  const list = scroller?.querySelector('.message-list')
  if (!(scroller instanceof HTMLElement) || !(list instanceof HTMLElement)) return empty
  const temporaryId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  const ids = new Set<string>()
  const rows = [...list.querySelectorAll('article.message-row[data-message-id]')].filter((row) => {
    const id = row.getAttribute('data-message-id')
    if (!id || id.length > 512 || temporaryId.test(id) || ids.has(id) || row.parentElement?.closest('article.message-row[data-message-id]')
      || row.closest('.quoted-reply,blockquote,[hidden],[aria-hidden="true"]')) return false
    ids.add(id)
    return true
  })
  const cursor = rows.findIndex(row => row.getAttribute('data-message-id') === beforeId)
  let wheel: AxiomHistoryObservation['wheel']
  if (scroll && scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight) {
    const rect = scroller.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const left = Math.max(0, rect.left); const top = Math.max(0, rect.top)
    const right = Math.min(viewportWidth, rect.right); const bottom = Math.min(viewportHeight, rect.bottom)
    const x = Math.floor((left + right) / 2); const y = Math.floor((top + bottom) / 2)
    if (right - left >= 2 && bottom - top >= 2 && x >= left && x < right && y >= top && y < bottom) {
      const hit = document.elementFromPoint(x, y)
      if (hit !== null && scroller.contains(hit)) wheel = { x, y, viewportWidth, viewportHeight,
        deltaY: Math.max(1, Math.min(600, Math.floor((bottom - top) * 0.8))) }
    }
  }
  if (cursor < 0) return { ...empty, supported: true, ...wheel === undefined ? {} : { wheel } }
  const { messages, sourceOrder } = read(beforeId)
  const first = messages[0]
  const firstIndex = first === undefined ? cursor : rows.findIndex(row => row.getAttribute('data-message-id') === first.id)
  return { url, supported: true, anchorFound: true, messages, ...wheel === undefined ? {} : { wheel },
    ...sourceOrder === undefined ? {} : { sourceOrder }, hasEarlier: firstIndex > 0, startVerified: false }
}
