/** Original-site authentication uses isolated native windows without projecting login content. */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  composer: true,
  loading: false,
  stalledLoad: false,
  warning: vi.fn(async (_window: object, _options: object) => ({ response: 0 })),
  windows: [] as unknown[], browserSession: {
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
    setDisplayMediaRequestHandler: vi.fn(), on: vi.fn(),
  },
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { dialog: { showMessageBox: fixture.warning }, session: { fromPartition: vi.fn(() => fixture.browserSession) },
    BrowserWindow: class extends EventEmitter {
      destroyed = false
      visible = false
      url = ''
      openHandler: ((details: { url: string; postBody?: unknown }) => {
        action: string
        overrideBrowserWindowOptions?: unknown
      }) | undefined
      webContents = Object.assign(new EventEmitter(), {
        getURL: () => this.url,
        isLoading: () => fixture.loading,
        executeJavaScript: vi.fn(async () => ({ url: this.url, title: 'Axiom', messages: [], composer: fixture.composer,
          draft: '', sendPresent: true, sendEnabled: false, siteStatus: null, limited: false })),
        setWindowOpenHandler: (handler: typeof this.openHandler) => { this.openHandler = handler },
      })
      constructor(readonly options: unknown) { super(); fixture.windows.push(this) }
      loadURL = vi.fn(async (url: string) => { this.url = url; if (fixture.stalledLoad) await new Promise<void>(() => {}) })
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
  return { createAxiomWebsiteWindow: (options: Electron.BrowserWindowConstructorOptions) => {
    const window = new BrowserWindow(options)
    Object.assign(window.webContents, { loadURL: (url: string) => window.loadURL(url) })
    return { window, contents: window.webContents }
  } }
})

import { BrowserWindow } from 'electron'
import { DesktopAxiomPage } from '../src/axiom-bridge.ts'

type WindowFixture = EventEmitter & {
  url: string
  destroyed: boolean
  visible: boolean
  options: unknown
  loadURL: ReturnType<typeof vi.fn>
  webContents: EventEmitter & { executeJavaScript: ReturnType<typeof vi.fn> }
  openHandler: (details: { url: string; postBody?: unknown }) => { action: string; overrideBrowserWindowOptions?: unknown }
}
const selected = 'https://chatgpt.com/dots/selected~conversation'
const owners: DesktopAxiomPage[] = []
afterEach(() => {
  for (const owner of owners.splice(0)) owner.disconnect()
  fixture.windows.length = 0
  fixture.warning.mockClear()
  fixture.composer = true
  fixture.loading = false
  fixture.stalledLoad = false
  vi.useRealTimers()
})

async function connect(): Promise<{ owner: DesktopAxiomPage; page: WindowFixture }> {
  const owner = new DesktopAxiomPage(() => {})
  owners.push(owner)
  await owner.connect(selected)
  return { owner, page: fixture.windows.at(-1) as WindowFixture }
}

describe('Axiom login windows', () => {
  it('returns a chosen ready Dot to native chat once and preserves an explicitly reopened website', async () => {
    const revealNative = vi.fn()
    const owner = new DesktopAxiomPage(() => {}, () => 'en', revealNative)
    owners.push(owner)
    await owner.choose(null)
    const page = fixture.windows.at(-1) as WindowFixture
    page.url = selected
    page.webContents.emit('did-navigate-in-page', {}, selected, true)
    expect(await owner.snapshot()).toMatchObject({ phase: 'ready', url: selected })
    expect(page.visible).toBe(false)
    expect(revealNative).toHaveBeenCalledOnce()
    owner.showLogin()
    await owner.connect(selected)
    expect(page.visible).toBe(true)
    expect(revealNative).toHaveBeenCalledOnce()
    await owner.choose(selected)
    expect(page.visible).toBe(false)
    expect(revealNative).toHaveBeenCalledTimes(2)
  })

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
    page.webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://chatgpt.com/?auth=complete', false, true)
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
  it('allows revealed social sign-in in the main window and one owned popup without reading identity pages', async () => {
    const { owner, page } = await connect()
    page.webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://auth.openai.com/log-in', false, true)
    page.url = 'https://auth.openai.com/log-in'
    const hidden = { preventDefault: vi.fn() }
    page.webContents.emit('will-redirect', hidden, 'https://accounts.google.com/o/oauth2/v2/auth', false, true)
    expect(hidden.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.warning).not.toHaveBeenCalled()
    owner.showLogin()
    for (const target of ['https://accounts.google.com/o/oauth2/v2/auth', 'https://appleid.apple.com/auth/authorize',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'https://login.live.com/oauth20_authorize.srf']) {
      const event = { preventDefault: vi.fn() }
      page.webContents.emit('will-redirect', event, target, false, true)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    const target = 'https://accounts.google.com/o/oauth2/v2/auth?state=PRIVATE_STATE'
    expect(page.openHandler({ url: target })).toMatchObject({ action: 'allow' })
    const popup = new BrowserWindow({ show: true }) as unknown as WindowFixture
    popup.visible = true
    page.webContents.emit('did-create-window', popup)
    popup.url = target
    page.webContents.executeJavaScript.mockClear()
    expect(await owner.snapshot()).toMatchObject({ phase: 'login-required', url: selected, messages: [] })
    expect(page.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(popup.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(popup.openHandler({ url: 'https://appleid.apple.com/auth/authorize' })).toEqual({ action: 'deny' })
    popup.url = selected
    popup.webContents.emit('did-finish-load')
    expect(popup.destroyed).toBe(true)
    expect(page.loadURL).toHaveBeenLastCalledWith(selected)
    // Returning to the conversation closes the identity-provider navigation allowance.
    const after = { preventDefault: vi.fn() }
    page.webContents.emit('will-redirect', after, target, false, true)
    expect(after.preventDefault).toHaveBeenCalledOnce()
  })

  it('reports blocked sign-in safely and keeps POST, hidden and nested popups refused', async () => {
    const publish = vi.fn()
    const owner = new DesktopAxiomPage(publish)
    owners.push(owner)
    await owner.connect(selected)
    const page = fixture.windows.at(-1) as WindowFixture
    owner.showLogin()
    page.webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://auth.openai.com/log-in', false, true)
    page.url = 'https://auth.openai.com/log-in?state=PRIVATE_AUTH'
    const blocked = { preventDefault: vi.fn() }
    page.webContents.emit('will-redirect', blocked, 'https://organization.example/sso?code=PRIVATE_CODE', false, true)
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    const state = await owner.snapshot()
    expect(state).toMatchObject({ phase: 'login-required', url: selected, errorCode: 'unsupported-page', canSend: false })
    expect(state.siteStatus).toContain('original sign-in method')
    expect(fixture.warning).toHaveBeenCalledOnce()
    expect(JSON.stringify([publish.mock.calls, fixture.warning.mock.calls.map(call => call[1])])).not.toContain('PRIVATE_')
    expect(JSON.stringify([publish.mock.calls, fixture.warning.mock.calls.map(call => call[1])])).not.toContain('organization.example')
    expect(page.openHandler({ url: 'https://accounts.google.com/o/oauth2/v2/auth', postBody: {} })).toEqual({ action: 'deny' })
    page.visible = false
    expect(page.openHandler({ url: 'https://accounts.google.com/o/oauth2/v2/auth' })).toEqual({ action: 'deny' })
  })

})

it('chooses a committed main-frame Dot without observing landing, auth, or unrelated ChatGPT pages', async () => {
  const publish = vi.fn()
  const owner = new DesktopAxiomPage(publish)
  owners.push(owner)
  expect(await owner.choose(null)).toMatchObject({ url: null, phase: 'login-required', messages: [] })
  const page = fixture.windows.at(-1) as WindowFixture
  expect(page.loadURL).toHaveBeenCalledWith('https://chatgpt.com/')
  expect(page.visible).toBe(true)
  expect(page.webContents.executeJavaScript).not.toHaveBeenCalled()
  await owner.connect('https://chatgpt.com/dots/old-binding')
  expect(page.loadURL).toHaveBeenCalledTimes(1)
  for (const url of ['https://auth.openai.com/log-in?state=PRIVATE_AUTH', 'https://chatgpt.com/c/unrelated']) {
    page.url = url
    page.webContents.emit('did-finish-load')
    expect(await owner.snapshot()).toMatchObject({ url: null, messages: [], canSend: false })
  }
  expect(page.webContents.executeJavaScript).not.toHaveBeenCalled()
  page.url = selected
  page.webContents.emit('did-navigate-in-page', {}, selected, false)
  expect(await owner.snapshot()).toMatchObject({ url: null, messages: [] })
  page.webContents.emit('did-navigate-in-page', {}, selected, true)
  expect(await owner.snapshot()).toMatchObject({ url: selected, phase: 'ready' })
  expect(page.webContents.executeJavaScript).toHaveBeenCalled()
  await owner.connect('https://chatgpt.com/dots/old-binding')
  expect(page.loadURL).toHaveBeenCalledTimes(1)
  await owner.connect(selected)
  const blocked = { isMainFrame: true, url: 'https://chatgpt.com/dots/other', preventDefault: vi.fn() }
  page.webContents.emit('will-frame-navigate', blocked)
  expect(blocked.preventDefault).toHaveBeenCalledOnce()
  expect(JSON.stringify(publish.mock.calls)).not.toContain('PRIVATE_AUTH')
})

it('reuses a ready selected Dot without opening another chooser or revealing unnecessary sign-in', async () => {
  const { owner, page } = await connect()
  expect(await owner.choose(selected)).toMatchObject({ url: selected, phase: 'ready' })
  expect(await owner.choose(null)).toMatchObject({ url: selected, phase: 'ready' })
  expect(page.visible).toBe(false)
  expect(fixture.windows).toHaveLength(1)
  page.webContents.emit('will-redirect', { preventDefault: vi.fn() }, 'https://auth.openai.com/log-in', false, true)
  page.url = 'https://auth.openai.com/log-in?state=PRIVATE_AUTH'
  expect(await owner.choose(selected)).toMatchObject({ url: selected, phase: 'login-required', messages: [] })
  expect(page.visible).toBe(true)
})

it('actually closes the original website and its popups, and waits for an explicit choice before reopening', async () => {
  const { owner, page } = await connect()
  owner.showLogin()
  const popup = new BrowserWindow({ show: true }) as unknown as WindowFixture
  page.webContents.emit('did-create-window', popup)
  page.destroyed = true
  page.emit('closed')
  expect(popup.destroyed).toBe(true)
  expect(await owner.snapshot()).toMatchObject({ phase: 'disconnected', url: null, messages: [] })
  await owner.connect(selected)
  expect(fixture.windows).toHaveLength(2)
  expect(await owner.choose(selected)).toMatchObject({ phase: 'ready', url: selected })
  expect(fixture.windows).toHaveLength(3)
})


it('waits for the original composer after document load and keeps observing the hidden connected page', async () => {
  fixture.composer = false
  const revealNative = vi.fn()
  const owner = new DesktopAxiomPage(() => {}, () => 'en', revealNative)
  owners.push(owner)
  expect(await owner.choose(selected)).toMatchObject({ phase: 'loading', url: selected })
  const page = fixture.windows.at(-1) as WindowFixture
  expect(page.visible).toBe(true)
  expect(page.options).toMatchObject({ webPreferences: { backgroundThrottling: false } })
  fixture.composer = true
  expect(await owner.snapshot()).toMatchObject({ phase: 'ready', url: selected })
  expect(page.visible).toBe(false)
  expect(page.destroyed).toBe(false)
  expect(revealNative).toHaveBeenCalledOnce()
  page.webContents.executeJavaScript.mockClear()
  expect(await owner.snapshot()).toMatchObject({ phase: 'ready', url: selected })
  expect(page.webContents.executeJavaScript).toHaveBeenCalledOnce()
  expect(page.visible).toBe(false)
})

it('reports an unavailable original page if its composer never appears within the loading deadline', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(0)
  fixture.composer = false
  const owner = new DesktopAxiomPage(() => {})
  owners.push(owner)
  expect(await owner.choose(selected)).toMatchObject({ phase: 'loading' })
  vi.setSystemTime(30001)
  expect(await owner.snapshot()).toMatchObject({ phase: 'unavailable', canSend: false })
})


it('returns loading without waiting for network completion or reading a document still loading', async () => {
  fixture.loading = true
  fixture.stalledLoad = true
  const owner = new DesktopAxiomPage(() => {})
  owners.push(owner)
  expect(await owner.choose(selected)).toMatchObject({ phase: 'loading', url: selected })
  const page = fixture.windows.at(-1) as WindowFixture
  expect(page.webContents.executeJavaScript).not.toHaveBeenCalled()
  fixture.loading = false
  expect(await owner.snapshot()).toMatchObject({ phase: 'ready', url: selected })
  expect(page.visible).toBe(false)
  expect(page.destroyed).toBe(false)
})

it('bounds an unresponsive read-only document without blocking later observations', async () => {
  vi.useFakeTimers()
  const { owner, page } = await connect()
  const stalled = Promise.withResolvers<unknown>()
  page.webContents.executeJavaScript.mockClear().mockReturnValueOnce(stalled.promise)
  const pending = owner.snapshot()
  await vi.advanceTimersByTimeAsync(5001)
  expect(await pending).toMatchObject({ phase: 'unavailable', errorCode: 'unsupported-page' })
  expect(await owner.snapshot()).toMatchObject({ phase: 'unavailable', canSend: false })
  expect(page.webContents.executeJavaScript).toHaveBeenCalledOnce()
  stalled.resolve(null)
  await Promise.resolve()
  expect(await owner.snapshot()).toMatchObject({ phase: 'ready', url: selected })
})
