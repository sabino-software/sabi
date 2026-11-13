/** Original website chrome owns only its own fixed reload/close controls and never covers website input. */
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ windows: new Array<unknown>(), views: new Array<unknown>(),
  ipc: undefined as EventEmitter | undefined, orphanContents: undefined as (() => object) | undefined }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const ipcMain = new EventEmitter()
  fixture.ipc = ipcMain
  class Contents extends EventEmitter {
    mainFrame = { url: '' }
    destroyed = false
    reload = vi.fn()
    focus = vi.fn()
    send = vi.fn()
    setWindowOpenHandler = vi.fn()
    loadURL = vi.fn(async (url: string) => { this.mainFrame.url = url })
    isDestroyed(): boolean { return this.destroyed }
    close = vi.fn(() => { this.destroyed = true; this.emit('destroyed') })
  }
  fixture.orphanContents = () => new Contents()
  return { ipcMain, Menu: { buildFromTemplate: vi.fn((value: unknown) => value) },
    BrowserWindow: class extends EventEmitter {
      destroyed = false
      webContents = new Contents()
      contentView = { addChildView: vi.fn() }
      setMenu = vi.fn()
      constructor(readonly options: unknown) { super(); fixture.windows.push(this) }
      getContentBounds(): { width: number; height: number } { return { width: 600, height: 800 } }
      isDestroyed(): boolean { return this.destroyed }
      isFocused(): boolean { return true }
      loadURL(url: string): Promise<void> { return this.webContents.loadURL(url) }
      destroy(): void { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
      close(): void { this.destroy() }
    },
    WebContentsView: class {
      webContents: Contents
      setBounds = vi.fn()
      constructor(readonly options: { webContents?: Contents }) {
        this.webContents = options.webContents ?? new Contents()
        fixture.views.push(this)
      }
    },
  }
})

import { createAxiomWebsiteWindow } from '../src/axiom-window.ts'
import { AXIOM_WINDOW_IPC, AXIOM_WINDOW_PAGE } from '../src/axiom-window-protocol.ts'

type WindowFixture = EventEmitter & {
  destroyed: boolean
  options: { webPreferences: object }
  contentView: { addChildView: ReturnType<typeof vi.fn> }
  webContents: { mainFrame: { url: string }; send: ReturnType<typeof vi.fn> }
  destroy(): void
}
type ViewFixture = {
  options: { webPreferences: { session: object; sandbox: boolean; preload?: string } }
  setBounds: ReturnType<typeof vi.fn>
}
afterEach(() => {
  for (const window of fixture.windows as WindowFixture[]) window.destroy()
  fixture.windows.length = 0
  fixture.views.length = 0
})

it('keeps chrome above website bounds, reloads only the owned page, and destroys contents on Close', () => {
  const isolatedSession = {} as Electron.Session
  const owned = createAxiomWebsiteWindow({ width: 600, height: 800, webPreferences: { session: isolatedSession } }, 'en')
  const reload = vi.spyOn(owned.contents, 'reload')
  const close = vi.spyOn(owned.contents, 'close')
  const window = fixture.windows[0] as WindowFixture
  const website = fixture.views[0] as ViewFixture
  expect(website.setBounds).toHaveBeenCalledWith({ x: 0, y: 48, width: 600, height: 752 })
  expect(website.options.webPreferences).toMatchObject({ session: isolatedSession, sandbox: true, nodeIntegration: false })
  expect(website.options.webPreferences.preload).toBeUndefined()
  expect(window.options.webPreferences).not.toHaveProperty('session')
  expect(window.contentView.addChildView).toHaveBeenCalledWith(website)
  const chrome = window.webContents
  expect(chrome.mainFrame.url).toBe(AXIOM_WINDOW_PAGE)
  const unauthorized = { sender: owned.contents, senderFrame: chrome.mainFrame }
  fixture.ipc!.emit(AXIOM_WINDOW_IPC.command, unauthorized, 'reload')
  expect(reload).not.toHaveBeenCalled()
  const owner = { sender: chrome, senderFrame: chrome.mainFrame }
  fixture.ipc!.emit(AXIOM_WINDOW_IPC.command, owner, 'status')
  expect(chrome.send).toHaveBeenCalledWith(AXIOM_WINDOW_IPC.labels, expect.objectContaining({ reload: 'Reload page', close: 'Close page' }))
  fixture.ipc!.emit(AXIOM_WINDOW_IPC.command, owner, 'reload')
  expect(reload).toHaveBeenCalledOnce()
  fixture.ipc!.emit(AXIOM_WINDOW_IPC.command, owner, 'close')
  expect(window.destroyed).toBe(true)
  expect(close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  expect(fixture.ipc!.listenerCount(AXIOM_WINDOW_IPC.command)).toBe(0)
})

it('adopts the original OAuth child contents only in the website view, keeping chrome separate', () => {
  const popupContents = fixture.orphanContents!() as Electron.WebContents
  const popup = createAxiomWebsiteWindow({ webContents: popupContents }, 'en')
  const popupWindow = fixture.windows[0] as WindowFixture
  expect(popup.contents).toBe(popupContents)
  expect(popupWindow.options).not.toHaveProperty('webContents')
  expect(popupWindow.webContents).not.toBe(popupContents)
  expect(popupWindow.webContents.mainFrame.url).toBe(AXIOM_WINDOW_PAGE)
})
