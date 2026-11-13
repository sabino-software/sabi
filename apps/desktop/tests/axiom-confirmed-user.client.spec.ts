// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/dots/fixture~conversation"}
/** Real serialized ACKs can recover background-skipped bodies without relaxing the DOM reader. */
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readAxiomPage } from '../src/axiom-page.ts'

const fixture = vi.hoisted(() => ({ windows: [] as unknown[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { dialog: { showMessageBox: vi.fn() }, session: { fromPartition: () => ({
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(), on: vi.fn(),
  }) }, BrowserWindow: class extends EventEmitter {
    url = ''
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, isLoading: () => false,
      executeJavaScript: vi.fn(async (script: string): Promise<unknown> => {
        const value: unknown = runInNewContext(script, { document, location, Node, HTMLElement, HTMLButtonElement, getComputedStyle, URL })
        return value
      }),
      insertText: vi.fn(async (text: string) => { document.querySelector('[role="textbox"]')!.textContent = text }),
      setWindowOpenHandler: vi.fn(), loadURL: vi.fn(async (url: string) => { this.url = url }),
    })
    constructor() { super(); fixture.windows.push(this) }
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return false }
    isFocused(): boolean { return false }
    destroy(): void { this.destroyed = true; this.emit('closed') }
  } }
})
vi.mock('../src/axiom-window.ts', async () => {
  const { BrowserWindow } = await import('electron')
  return { createAxiomWebsiteWindow: () => { const window = new BrowserWindow(); return { window, contents: window.webContents } } }
})
import type { BrowserWindow } from 'electron'
import { DesktopAxiomPage } from '../src/axiom-bridge.ts'

const url = 'https://chatgpt.com/dots/fixture~conversation'
const user = 'fixture~CalpicoMessage~Sentinel_user'
const reply = 'fixture~CalpicoMessage~Sentinel_reply'
const text = 'An *authored* message'
const owners: DesktopAxiomPage[] = []
const innerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
beforeEach(() => {
  window.history.replaceState({}, '', url)
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true,
    get(this: HTMLElement) { return this.textContent },
  })
  document.body.innerHTML = '<div role="textbox" contenteditable="true" aria-label="Message"></div><button aria-label="Send">Send</button>'
  document.querySelector('button')!.addEventListener('click', () => {
    append(user, text, true)
    append(reply, 'Original reply', false)
    document.querySelector('[role="textbox"]')!.textContent = ''
  })
})
afterEach(() => {
  for (const owner of owners.splice(0)) owner.disconnect()
  fixture.windows.length = 0
  if (innerText) Object.defineProperty(HTMLElement.prototype, 'innerText', innerText)
  else Reflect.deleteProperty(HTMLElement.prototype, 'innerText')
  vi.restoreAllMocks()
})

function append(id: string, bodyText: string, self: boolean): void {
  const row = document.createElement('article')
  row.className = self ? 'message-row self' : 'message-row'
  row.dataset.messageId = id
  row.innerHTML = '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"></div></div></div></div>'
  const body = row.querySelector<HTMLElement>('.message-text')!
  body.textContent = bodyText
  if (self) body.style.visibility = 'hidden'
  document.body.append(row)
}

async function connect() {
  const owner = new DesktopAxiomPage(() => {})
  owners.push(owner)
  const snapshot = await owner.connect(url)
  const page = fixture.windows.at(-1) as BrowserWindow
  return { owner, page, snapshot }
}

it('fills only the committed ACK row in source order and later uses the actual DOM body', async () => {
  const { owner, snapshot } = await connect()
  const result = await owner.send({ requestId: 'fixture-send-1', revision: snapshot.revision, text })
  expect(result.status).toBe('confirmed')
  expect(readAxiomPage().messages.map(body => body.id)).toEqual([reply])
  expect(result.snapshot.messages).toEqual([
    { id: user, role: 'user', text: 'An \\*authored\\* message', timestamp: null, truncated: false },
    { id: reply, role: 'assistant', text: 'Original reply', timestamp: null, truncated: false },
  ])
  const body = document.querySelector<HTMLElement>('.self .message-text')!
  body.style.visibility = ''
  body.innerHTML = '<strong>Actual source body</strong>'
  expect((await owner.snapshot()).messages[0]).toMatchObject({ id: user, text: '**Actual source body**' })
  expect((await owner.snapshot()).messages.filter(message => message.id === user)).toHaveLength(1)
  body.style.visibility = 'hidden'
  document.querySelector('.self')!.remove()
  expect((await owner.snapshot()).messages.map(message => message.id)).toEqual([reply])
})

it('does not recover an unacknowledged row or carry a confirmed body to another document', async () => {
  append(user, text, true)
  const h = await connect()
  expect(h.snapshot.messages).toEqual([])
  document.querySelector('.self')!.remove()
  expect((await h.owner.send({ requestId: 'fixture-send-2', revision: h.snapshot.revision, text })).status).toBe('confirmed')
  h.page.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  expect((await h.owner.snapshot()).messages.map(message => message.id)).toEqual([reply])
})

it('revokes confirmed bodies on source change even if the new source contains the same ID', async () => {
  const { owner, snapshot } = await connect()
  expect((await owner.send({ requestId: 'fixture-send-4', revision: snapshot.revision, text })).status).toBe('confirmed')
  const another = 'https://chatgpt.com/dots/another~conversation'
  window.history.replaceState({}, '', another)
  expect((await owner.connect(another)).messages.map(message => message.id)).toEqual([reply])
})

it.each(['abort', 'disconnect', 'navigation', 'crash'] as const)('does not record an ACK arriving after %s', async (revoke) => {
  const { owner, page, snapshot } = await connect()
  const execute = vi.spyOn(page.webContents, 'executeJavaScript')
  const original = execute.getMockImplementation()!
  const ack = Promise.withResolvers<unknown>()
  const waiting = Promise.withResolvers<boolean>()
  execute.mockImplementation(async (script: string) => {
    if (script.includes('function findAxiomAcknowledgement')) { waiting.resolve(true); return ack.promise }
    const value: unknown = await original(script)
    return value
  })
  const signal = new AbortController()
  const pending = owner.send({ requestId: 'fixture-send-3', revision: snapshot.revision, text }, signal.signal)
  await waiting.promise
  if (revoke === 'abort') signal.abort()
  if (revoke === 'disconnect') owner.disconnect()
  if (revoke === 'navigation') page.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  if (revoke === 'crash') page.webContents.emit('render-process-gone')
  ack.resolve(user)
  expect((await pending).status).toBe('unknown')
  expect((await owner.snapshot()).messages.some(message => message.id === user)).toBe(false)
})
