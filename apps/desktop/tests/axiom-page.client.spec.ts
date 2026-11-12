// @vitest-environment jsdom
/** Original message DOM is projected without actions, hidden content, or active media. */
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { clickAxiomSend, findAxiomAcknowledgement, focusAxiomComposer, readAxiomPage } from '../src/axiom-page.ts'

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
})
