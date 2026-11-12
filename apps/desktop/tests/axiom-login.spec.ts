/** Original-site authentication uses isolated native windows without projecting login content. */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ windows: [] as unknown[], browserSession: {
  setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
  setDisplayMediaRequestHandler: vi.fn(), on: vi.fn(),
} }))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { session: { fromPartition: vi.fn(() => fixture.browserSession) }, BrowserWindow: class extends EventEmitter {
    destroyed = false
    visible = false
    url = ''
    openHandler: ((details: { url: string; postBody?: unknown }) => { action: string; overrideBrowserWindowOptions?: unknown }) | undefined
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url,
      isLoading: () => false,
      executeJavaScript: vi.fn(async () => ({ url: this.url, title: 'Axiom', messages: [], composer: true,
        draft: '', sendPresent: true, sendEnabled: false, siteStatus: null, limited: false })),
      setWindowOpenHandler: (handler: typeof this.openHandler) => { this.openHandler = handler },
    })
    constructor(readonly options: unknown) { super(); fixture.windows.push(this) }
    loadURL = vi.fn(async (url: string) => { this.url = url })
    isDestroyed(): boolean { return this.destroyed }
    isVisible(): boolean { return this.visible }
    show(): void { this.visible = true }
    hide(): void { this.visible = false }
    destroy(): void { this.destroyed = true; this.emit('closed') }
  } }
})

import { BrowserWindow } from 'electron'
import { DesktopAxiomPage } from '../src/axiom-bridge.ts'

type WindowFixture = EventEmitter & {
  url: string; destroyed: boolean; options: unknown; loadURL: ReturnType<typeof vi.fn>
  webContents: EventEmitter & { executeJavaScript: ReturnType<typeof vi.fn> }
  openHandler: (details: { url: string; postBody?: unknown }) => { action: string; overrideBrowserWindowOptions?: unknown }
}
const selected = 'https://chatgpt.com/dots/selected~conversation'
const owners: DesktopAxiomPage[] = []
afterEach(() => { for (const owner of owners.splice(0)) owner.disconnect(); fixture.windows.length = 0 })

async function connect(): Promise<{ owner: DesktopAxiomPage; page: WindowFixture }> {
  const owner = new DesktopAxiomPage(() => {})
  owners.push(owner)
  await owner.connect(selected)
  return { owner, page: fixture.windows.at(-1) as WindowFixture }
}

describe('Axiom login windows', () => {
  it('admits official authentication redirects without reading or exporting their page content', async () => {
    const { owner, page } = await connect()
    const allowed = { preventDefault: vi.fn() }
    page.webContents.emit('will-redirect', allowed, 'https://auth.openai.com/log-in?state=private', false, true)
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    page.url = 'https://auth.openai.com/log-in?state=private'
    page.webContents.executeJavaScript.mockClear()
    expect(await owner.snapshot()).toMatchObject({ phase: 'login-required', url: selected, messages: [], canSend: false })
    expect(page.webContents.executeJavaScript).not.toHaveBeenCalled()
    const blocked = { preventDefault: vi.fn() }
    page.webContents.emit('will-redirect', blocked, 'https://evil.test/callback', false, true)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    page.url = 'https://chatgpt.com/?auth=complete'
    page.webContents.emit('did-finish-load')
    expect(page.loadURL).toHaveBeenLastCalledWith(selected)
  })

  it('allows only an explicit login popup in the same sandboxed session and closes it on return', async () => {
    const { owner, page } = await connect()
    const destination = { url: 'https://auth.openai.com/log-in' }
    expect(page.openHandler(destination)).toEqual({ action: 'deny' })
    owner.showLogin()
    expect(page.openHandler({ url: 'https://evil.test/' })).toEqual({ action: 'deny' })
    expect(page.openHandler({ ...destination, postBody: {} })).toEqual({ action: 'deny' })
    const admitted = page.openHandler(destination)
    expect(admitted).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: {
      session: fixture.browserSession, sandbox: true, nodeIntegration: false, contextIsolation: true,
    } } })
    const popup = new BrowserWindow({ show: true }) as unknown as WindowFixture
    page.webContents.emit('did-create-window', popup)
    expect(page.openHandler(destination)).toEqual({ action: 'deny' })
    expect(popup.openHandler(destination)).toEqual({ action: 'deny' })
    const blocked = { isMainFrame: true, url: 'https://chatgpt.com/dots/other', preventDefault: vi.fn() }
    popup.webContents.emit('will-frame-navigate', blocked)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(await owner.snapshot()).toMatchObject({ phase: 'login-required', canSend: false })
    popup.url = selected
    popup.webContents.emit('did-finish-load')
    expect(popup.destroyed).toBe(true)
    expect(page.loadURL).toHaveBeenLastCalledWith(selected)
  })

  it('destroys owned authentication windows when disconnecting', async () => {
    const { owner, page } = await connect()
    owner.showLogin()
    page.openHandler({ url: 'https://auth.openai.com/log-in' })
    const popup = new BrowserWindow({ show: true }) as unknown as WindowFixture
    page.webContents.emit('did-create-window', popup)
    owner.disconnect()
    expect(popup.destroyed).toBe(true)
    expect(page.destroyed).toBe(true)
    expect(await owner.snapshot()).toMatchObject({ phase: 'disconnected', url: null })
  })
})
