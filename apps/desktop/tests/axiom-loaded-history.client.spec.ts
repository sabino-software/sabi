// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/dots/selected~conversation"}
/** Already loaded original rows paginate through the live page without moving it or observing its draft. */
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
    visible = false
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, isLoading: () => false,
      executeJavaScript: vi.fn(async (script: string): Promise<unknown> => {
        // Execute only the bridge's serialized source reader against this synthetic DOM, without Electron or a browser.
        const value: unknown = runInNewContext(script, { document, location, Node, HTMLElement, HTMLButtonElement, getComputedStyle, URL })
        return value
      }),
      setWindowOpenHandler: vi.fn(), loadURL: vi.fn(async (url: string) => { this.url = url }),
    })
    constructor() { super(); fixture.windows.push(this) }
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return this.visible }
    isFocused(): boolean { return this.visible }
    show(): void { this.visible = true }
    hide(): void { this.visible = false }
    destroy(): void { this.destroyed = true; this.emit('closed') }
  } }
})
vi.mock('../src/axiom-window.ts', async () => {
  const { BrowserWindow } = await import('electron')
  return { createAxiomWebsiteWindow: () => { const window = new BrowserWindow(); return { window, contents: window.webContents } } }
})
import type { BrowserWindow } from 'electron'
import { DesktopAxiomPage } from '../src/axiom-bridge.ts'
import { DesktopAxiomHistory } from '../src/axiom-history.ts'

const selected = 'https://chatgpt.com/dots/selected~conversation'
const sourceId = (index: number): string => `source~CalpicoMessage~Sentinel_${index}`
const owners: DesktopAxiomPage[] = []
const innerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true,
    get(this: HTMLElement) { return this.textContent },
  })
  document.body.innerHTML = '<section class="messages-scroll"><div class="message-list"></div></section>'
    + '<div role="textbox" contenteditable="true" aria-label="Message">Preserved original draft</div>'
    + '<button aria-label="Send">Send</button><input aria-label="Other input">'
  const list = document.querySelector('.message-list')!
  for (let index = 0; index < 292; index++) {
    const row = document.createElement('article')
    row.className = index % 2 === 0 ? 'message-row self' : 'message-row'
    row.dataset.messageId = sourceId(index)
    row.innerHTML = '<div class="message-body"><div class="message-surface"><div class="message-bubble"><div class="message-text"></div></div></div></div>'
    row.querySelector('.message-text')!.textContent = `Original message ${index}`
    list.append(row)
  }
})
afterEach(() => {
  for (const owner of owners.splice(0)) owner.disconnect()
  fixture.windows.length = 0
  if (innerText) Object.defineProperty(HTMLElement.prototype, 'innerText', innerText)
  else Reflect.deleteProperty(HTMLElement.prototype, 'innerText')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function connect() {
  const publish = vi.fn()
  const owner = new DesktopAxiomPage(publish)
  owners.push(owner)
  const snapshot = await owner.connect(selected)
  const page = fixture.windows[0] as BrowserWindow
  return { owner, page, publish, snapshot, execute: vi.spyOn(page.webContents, 'executeJavaScript') }
}

it('reads all 292 already-loaded original rows without another page, scrolling, focusing, or reading the draft', async () => {
  const h = await connect()
  expect(h.snapshot.phase).toBe('ready')
  const scroller = document.querySelector('.messages-scroll')!
  scroller.scrollTop = 39058
  const input = document.querySelector('input')!
  input.focus()
  const composer = document.querySelector('[role="textbox"]')!
  Object.defineProperty(composer, 'innerText', { configurable: true, get: () => { throw new Error('History read the draft') } })
  h.publish.mockClear()
  let messages = [...h.snapshot.messages]
  expect(messages).toHaveLength(100)
  for (let count = 0; count < 2; count++) {
    const page = await h.owner.historyBefore(messages[0]!.id)
    expect(page.status).toBe('ready')
    expect(page.hasMore).toBe(true)
    expect(page.messages.length).toBeLessThanOrEqual(100)
    messages = [...page.messages, ...messages]
  }
  expect(messages.map(message => message.id)).toEqual(Array.from({ length: 292 }, (_, index) => sourceId(index)))
  expect(fixture.windows).toHaveLength(1)
  expect(scroller.scrollTop).toBe(39058)
  expect(document.activeElement).toBe(input)
  expect(composer.textContent).toBe('Preserved original draft')
  expect(h.publish).not.toHaveBeenCalled()
  Reflect.deleteProperty(composer, 'innerText')
  expect(await h.owner.snapshot()).toMatchObject({ phase: 'ready', draftPresent: true, canSend: true })
})

it('uses the secondary scroller only when no older bodies are loaded in the selected primary page', async () => {
  const fallback = vi.spyOn(DesktopAxiomHistory.prototype, 'before')
    .mockResolvedValue({ messages: [], hasMore: true, status: 'unavailable' })
  const h = await connect()
  expect((await h.owner.historyBefore(sourceId(192))).status).toBe('ready')
  expect(fallback).not.toHaveBeenCalled()
  expect(await h.owner.historyBefore(sourceId(0))).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(fallback).toHaveBeenCalledExactlyOnceWith(selected, sourceId(0))
})

it('joins a normal outstanding live snapshot before reading primary history without overlapping renderer work', async () => {
  const h = await connect()
  const pending = Promise.withResolvers<unknown>()
  h.execute.mockClear().mockReturnValueOnce(pending.promise)
  const snapshot = h.owner.snapshot()
  const history = h.owner.historyBefore(sourceId(192))
  expect(h.execute).toHaveBeenCalledOnce()
  pending.resolve(readAxiomPage())
  expect(await snapshot).toMatchObject({ phase: 'ready' })
  expect(await history).toMatchObject({ status: 'ready', hasMore: true })
  expect(h.execute).toHaveBeenCalledTimes(2)
})

it('bounds a primary history read without poisoning snapshot phase or queueing more renderer work', async () => {
  vi.useFakeTimers()
  const h = await connect()
  const pending = Promise.withResolvers<unknown>()
  h.execute.mockClear().mockReturnValueOnce(pending.promise)
  const history = h.owner.historyBefore(sourceId(192))
  expect(await h.owner.snapshot()).toMatchObject({ phase: 'ready', draftPresent: true })
  await vi.advanceTimersByTimeAsync(5001)
  expect(await history).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(await h.owner.historyBefore(sourceId(192))).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(h.execute).toHaveBeenCalledOnce()
  pending.resolve(readAxiomPage(sourceId(192)))
  await Promise.resolve()
  expect((await h.owner.historyBefore(sourceId(192))).status).toBe('ready')
})

it('cancels a primary history read on close and rejects a late result from that page', async () => {
  const h = await connect()
  const pending = Promise.withResolvers<unknown>()
  h.execute.mockReturnValueOnce(pending.promise)
  const history = h.owner.historyBefore(sourceId(192))
  h.owner.disconnect()
  expect(await history).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  pending.resolve(readAxiomPage(sourceId(192)))
  expect(await h.owner.snapshot()).toMatchObject({ phase: 'disconnected', messages: [] })
})

it('rejects old-document history after same-URL navigation and allows the new document to be observed', async () => {
  const h = await connect()
  const pending = Promise.withResolvers<unknown>()
  h.execute.mockReturnValueOnce(pending.promise)
  const history = h.owner.historyBefore(sourceId(192))
  h.page.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: selected })
  expect(await history).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(await h.owner.snapshot()).toMatchObject({ phase: 'ready', draftPresent: true })
  pending.resolve(readAxiomPage(sourceId(192)))
  expect((await h.owner.historyBefore(sourceId(192))).status).toBe('ready')
})

it('never reads primary history from a different or authentication document', async () => {
  const h = await connect()
  vi.spyOn(h.page.webContents, 'getURL').mockReturnValue('https://auth.openai.com/log-in?state=fixture')
  h.execute.mockClear()
  expect(await h.owner.historyBefore(sourceId(192))).toEqual({ messages: [], hasMore: true, status: 'unavailable' })
  expect(h.execute).not.toHaveBeenCalled()
})
