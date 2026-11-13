/** DOM operations limited to the observed ChatGPT Dot message and composer elements. */
import type { AxiomMessage } from './axiom-protocol.ts'

/** DOM-only snapshot returned from the isolated original page. */
export interface AxiomPageState {
  readonly url: string
  readonly title: string
  readonly messages: readonly AxiomMessage[]
  readonly composer: boolean
  readonly draft: string
  readonly sendPresent: boolean
  readonly sendEnabled: boolean
  readonly siteStatus: string | null
  readonly limited: boolean
}

/**
 * Read rendered message bodies without page storage, application state, or network interception.
 * This function is serialized into the original page and therefore has no module references.
 * @returns Original-page text in source order, retaining the newest messages within the bounds, and observed composer state.
 */
export function readAxiomPage(): AxiomPageState {
  const rows = [...document.querySelectorAll('article.message-row[data-message-id]')]
  const messages: AxiomMessage[] = []
  let remaining = 131072
  let limited = rows.length > 100
  for (const row of rows.slice(-100).reverse()) {
    const id = row.getAttribute('data-message-id')
    const body = row.querySelector('.message-body > .message-surface .message-bubble .message-text')
    if (id === null || id.length > 512 || body === null) continue
    const escape = (text: string): string => text.replaceAll(/([\\`*_[\]<>|~])/gu, '\\$1')
    const serialize = (node: Node, depth = 0): string => {
      if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '')
      if (!(node instanceof HTMLElement)) return ''
      if (node.matches('script,style,button,.message-inline-actions,[hidden],[aria-hidden="true"]')) return ''
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
      timestamp: row.querySelector('time')?.getAttribute('datetime')?.slice(0, 100) ?? null, truncated })
  }
  messages.reverse()
  const composer = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label="Message"]')
  const send = document.querySelector('button[aria-label="Send"]')
  const status = document.querySelector('[role="status"].typing-indicator[aria-live="polite"]')
  return {
    url: location.href, title: document.title.slice(0, 300), messages,
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
 * Find original-page acknowledgement after one click, without exposing composer or unrelated page text.
 * @param text Exact submitted user text.
 * @param before IDs present immediately before submission.
 * @returns The stable ID of a newly rendered matching user message, or null.
 */
export function findAxiomAcknowledgement(text: string, before: readonly string[]): string | null {
  for (const row of document.querySelectorAll('article.message-row.self[data-message-id]')) {
    const id = row.getAttribute('data-message-id')
    const body = row.querySelector('.message-body > .message-surface .message-bubble .message-text')
    if (id !== null && id.length <= 512 && !before.includes(id) && body instanceof HTMLElement
      && body.innerText.replaceAll('\r\n', '\n').trim() === text.trim()) return id
  }
  return null
}
