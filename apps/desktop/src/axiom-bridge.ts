/** Persistent original-site page ownership; Harness renders only bounded DOM projections. */
import { BrowserWindow, session } from 'electron'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AxiomSendRequest, AxiomSendResult, AxiomSnapshot } from './axiom-protocol.ts'
import { readAxiomPage, focusAxiomComposer, clickAxiomSend, findAxiomAcknowledgement } from './axiom-page.ts'
import { axiomConversationUrl, axiomNavigation } from './axiom-navigation.ts'

export { axiomConversationUrl } from './axiom-navigation.ts'

const pageSchema = z.object({
  url: z.string().max(4096), title: z.string().max(300),
  messages: z.array(z.object({ id: z.string().max(512), role: z.enum(['user', 'assistant']),
    text: z.string().max(32768), timestamp: z.string().max(100).nullable(), truncated: z.boolean() })).max(100),
  composer: z.boolean(), draft: z.string().max(131073), sendPresent: z.boolean(), sendEnabled: z.boolean(),
  siteStatus: z.string().max(500).nullable(), limited: z.boolean(),
})
const requestSchema = z.object({ requestId: z.string().min(8).max(200).regex(/^[a-zA-Z0-9_-]+$/u),
  revision: z.number().int().nonnegative(), text: z.string().min(1).max(131072) }).strict()

function initialSnapshot(): AxiomSnapshot {
  return { source: 'chatgpt-web', url: null, title: '', revision: 0, phase: 'disconnected',
    messages: [], canSend: false, draftPresent: false, siteStatus: null, limited: false }
}

/** Owns one user-selected original page; never reads or exports session cookies or token storage. */
export class DesktopAxiomPage {
  private page: BrowserWindow | undefined
  private selected: string | null = null
  private current = initialSnapshot()
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshing: Promise<AxiomSnapshot> | undefined
  private sending = false
  private closing = false
  private sessionConfigured = false
  private authenticating = false
  private readonly loginPopups = new Set<BrowserWindow>()
  private readonly submissions = new Map<string, { digest: string; pending?: Promise<AxiomSendResult>; outcome?: Pick<AxiomSendResult, 'status' | 'messageId'> }>()

  /** @param publish Sends safe projections only to the owned application renderer. */
  constructor(private readonly publish: (snapshot: AxiomSnapshot) => void) {}

  /**
   * Open a directly selected conversation in its dedicated persistent original-site session.
   * @param value Exact conversation URL selected by the user.
   * @param signal Optional owning Host cancellation; an aborted call cannot replace the selected page.
   * @returns Initial bounded DOM projection; authentication remains in the original website.
   */
  async connect(value: unknown, signal?: AbortSignal): Promise<AxiomSnapshot> {
    signal?.throwIfAborted()
    const url = axiomConversationUrl(value)
    if (this.selected === url && this.page !== undefined && !this.page.isDestroyed()) return this.snapshot()
    this.disconnect()
    this.selected = url
    const generation = this.generation
    const browserSession = session.fromPartition('persist:skeinlet-axiom')
    if (!this.sessionConfigured) {
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
      browserSession.setPermissionCheckHandler(() => false)
      browserSession.setDevicePermissionHandler(() => false)
      browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
      browserSession.on('will-download', event => { event.preventDefault() })
      this.sessionConfigured = true
    }
    const page = new BrowserWindow({ show: false, width: 1100, height: 800,
      webPreferences: { session: browserSession, nodeIntegration: false, nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
        backgroundThrottling: false, spellcheck: false },
    })
    this.page = page
    const admit = (target: string): boolean => {
      const category = axiomNavigation(target, url, this.authenticating)
      if (category === 'authentication') this.authenticating = true
      return category !== 'blocked'
    }
    page.webContents.setWindowOpenHandler(details => {
      if (this.page !== page || generation !== this.generation || !page.isVisible()
        || this.loginPopups.size > 0 || details.postBody !== undefined
        || axiomNavigation(details.url, url, this.authenticating) !== 'authentication') return { action: 'deny' }
      this.authenticating = true
      return { action: 'allow', overrideBrowserWindowOptions: { show: true, width: 600, height: 800,
        webPreferences: { session: browserSession, nodeIntegration: false, nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
          allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false },
      } }
    })
    const guardNavigation = (window: BrowserWindow): void => {
      window.webContents.on('will-frame-navigate', event => {
        if (event.isMainFrame && !admit(event.url)) event.preventDefault()
      })
      window.webContents.on('will-redirect', (event, target, _inPlace, mainFrame) => {
        if (mainFrame && !admit(target)) event.preventDefault()
      })
    }
    guardNavigation(page)
    const returnToSelected = (window: BrowserWindow): void => {
      if (this.page !== page || generation !== this.generation || window.isDestroyed()) return
      const category = axiomNavigation(window.webContents.getURL(), url, this.authenticating)
      if (category !== 'return' && !(window !== page && category === 'conversation')) return
      this.authenticating = false
      if (window !== page) window.destroy()
      void page.loadURL(url).catch((_loginReturnFailure: unknown) => {
        if (this.page === page) this.unavailable('page-unavailable')
      })
    }
    page.webContents.on('did-create-window', popup => {
      if (this.page !== page || generation !== this.generation) { popup.destroy(); return }
      this.loginPopups.add(popup)
      guardNavigation(popup)
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      popup.webContents.on('will-attach-webview', event => { event.preventDefault() })
      popup.webContents.on('did-finish-load', () => { returnToSelected(popup) })
      popup.once('closed', () => {
        this.loginPopups.delete(popup)
        if (this.page === page) void this.snapshot()
      })
    })
    page.webContents.on('did-finish-load', () => { returnToSelected(page) })
    page.webContents.on('will-attach-webview', event => { event.preventDefault() })
    page.webContents.on('render-process-gone', () => { if (this.page === page) this.unavailable('page-unavailable') })
    page.on('close', event => { if (!this.closing) { event.preventDefault(); page.hide() } })
    page.webContents.on('did-finish-load', () => { if (this.page === page) void this.snapshot() })
    this.update({ ...initialSnapshot(), url, phase: 'loading' })
    try { await page.loadURL(url) }
    catch (_pageLoadFailure) { if (generation === this.generation) this.unavailable('page-unavailable') }
    if (generation !== this.generation) return this.current
    this.schedule(generation)
    return this.snapshot()
  }

  /** @returns Latest DOM projection; concurrent callers share one page read. */
  snapshot(): Promise<AxiomSnapshot> {
    if (this.refreshing !== undefined) return this.refreshing
    const generation = this.generation
    const pending = this.read(generation)
    this.refreshing = pending
    void pending.finally(() => { if (this.refreshing === pending) this.refreshing = undefined })
    return pending
  }

  /** Show the original page for direct OpenAI authentication; any approved login popup shares its isolated session. */
  showLogin(): void {
    if (this.page === undefined || this.page.isDestroyed()) throw new Error('Connect an original conversation first')
    this.page.show()
  }

  /** Stop observation and destroy the page; retain the session's website-owned login state. */
  disconnect(): void {
    this.generation++
    clearTimeout(this.timer)
    this.timer = undefined
    this.refreshing = undefined
    const page = this.page
    this.page = undefined
    this.authenticating = false
    for (const popup of this.loginPopups) if (!popup.isDestroyed()) popup.destroy()
    this.loginPopups.clear()
    this.selected = null
    this.closing = true
    if (page !== undefined && !page.isDestroyed()) page.destroy()
    this.closing = false
    this.update(initialSnapshot())
  }

  /**
   * Submit only explicit user-authored text through the real page's enabled Send control.
   * @param value User request with deduplication identity and observed revision.
   * @param signal Optional owning Host cancellation; prevents further native input after cancellation.
   * @returns Original-page acknowledgement, refusal, or an ambiguous outcome that must not be retried automatically.
   */
  send(value: unknown, signal?: AbortSignal): Promise<AxiomSendResult> {
    const parsed = requestSchema.safeParse(value)
    if (!parsed.success) return Promise.resolve({ status: 'refused', snapshot: this.current })
    const request = parsed.data
    const digest = createHash('sha256').update(request.text).digest('hex')
    const prior = this.submissions.get(request.requestId)
    if (prior !== undefined) {
      if (prior.digest !== digest) return Promise.resolve({ status: 'refused', snapshot: this.current })
      if (prior.pending !== undefined) return prior.pending
      return Promise.resolve({ status: prior.outcome?.status ?? 'unknown', snapshot: this.current,
        ...prior.outcome?.messageId === undefined ? {} : { messageId: prior.outcome.messageId } })
    }
    const entry: { digest: string; pending?: Promise<AxiomSendResult>; outcome?: Pick<AxiomSendResult, 'status' | 'messageId'> } = { digest }
    const result = this.submit(request, signal)
    entry.pending = result
    this.submissions.set(request.requestId, entry)
    void result.then(outcome => {
      entry.outcome = { status: outcome.status, ...outcome.messageId === undefined ? {} : { messageId: outcome.messageId } }
      delete entry.pending
    })
    return result
  }

  private async submit(request: AxiomSendRequest, signal?: AbortSignal): Promise<AxiomSendResult> {
    if (signal?.aborted || this.sending || request.revision !== this.current.revision || request.text.trim() === '') return { status: 'refused', snapshot: this.current }
    const page = this.page
    const generation = this.generation
    const selected = this.selected
    if (page === undefined || page.isDestroyed() || selected === null || !this.matches(page.webContents.getURL())) {
      return { status: 'refused', snapshot: this.current }
    }
    this.sending = true
    let attemptedClick = false
    try {
      const state = await this.snapshot()
      if (signal?.aborted || generation !== this.generation || !state.canSend || state.draftPresent || !this.matches(page.webContents.getURL())) return { status: 'refused', snapshot: state }
      const ids: unknown = await page.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('article.message-row[data-message-id]'), row => row.getAttribute('data-message-id'))")
      const before = z.array(z.string().max(512)).max(10000).parse(ids)
      const focused: unknown = await page.webContents.executeJavaScript(`(${focusAxiomComposer.toString()})()`, true)
      if (signal?.aborted || focused !== true || generation !== this.generation || !this.matches(page.webContents.getURL())) return { status: 'refused', snapshot: this.current }
      await page.webContents.insertText(request.text)
      if (signal?.aborted || generation !== this.generation || !this.matches(page.webContents.getURL())) return { status: 'unknown', snapshot: this.current }
      attemptedClick = true
      const accepted: unknown = await page.webContents.executeJavaScript(
        `location.href.replace(/\\/$/, '') === ${JSON.stringify(selected)} && (${clickAxiomSend.toString()})(${JSON.stringify(request.text)})`, true)
      if (accepted !== true) return { status: 'refused', snapshot: await this.snapshot() }
      const deadline = Date.now() + 12000
      while (!signal?.aborted && generation === this.generation && !page.isDestroyed() && this.matches(page.webContents.getURL()) && Date.now() < deadline) {
        const id: unknown = await page.webContents.executeJavaScript(
          `(${findAxiomAcknowledgement.toString()})(${JSON.stringify(request.text)},${JSON.stringify(before)})`)
        if (typeof id === 'string') return { status: 'confirmed', messageId: id, snapshot: await this.snapshot() }
        await new Promise<void>(resolve => { setTimeout(resolve, 250) })
      }
      return { status: 'unknown', snapshot: await this.snapshot() }
    } catch (_pageSubmissionFailure) {
      return { status: attemptedClick ? 'unknown' : 'refused', snapshot: this.current }
    } finally { this.sending = false }
  }

  private matches(url: string): boolean {
    try { return axiomConversationUrl(url) === this.selected } catch (_differentPage) { return false }
  }

  private async read(generation: number): Promise<AxiomSnapshot> {
    const page = this.page
    if (page === undefined || page.isDestroyed()) return this.current
    if (this.loginPopups.size > 0 || !this.matches(page.webContents.getURL())) {
      const currentUrl = page.webContents.getURL()
      if (currentUrl === '' || currentUrl === 'about:blank') return this.current
      const category = this.selected === null ? 'blocked' : axiomNavigation(currentUrl, this.selected, this.authenticating)
      const loginPage = this.loginPopups.size > 0 || category === 'authentication' || category === 'return'
      this.update({ ...initialSnapshot(), url: this.selected, phase: loginPage ? 'login-required' : 'unavailable',
        ...loginPage ? {} : { errorCode: 'unsupported-page' as const } })
      return this.current
    }
    try {
      const raw: unknown = await page.webContents.executeJavaScript(`(${readAxiomPage.toString()})()`)
      const state = pageSchema.parse(raw)
      if (generation !== this.generation || !this.matches(state.url) || !this.matches(page.webContents.getURL())) return this.current
      this.update({ source: 'chatgpt-web', url: this.selected, title: state.title, revision: this.current.revision,
        phase: state.composer ? 'ready' : page.webContents.isLoading() ? 'loading' : 'unavailable',
        messages: state.messages, canSend: state.composer && state.sendPresent, draftPresent: state.draft.trim() !== '',
        siteStatus: state.siteStatus, limited: state.limited })
    } catch (_unsupportedPage) { if (generation === this.generation) this.unavailable('unsupported-page') }
    return this.current
  }

  private unavailable(errorCode: 'page-unavailable' | 'unsupported-page'): void {
    this.update({ ...initialSnapshot(), url: this.selected, phase: 'unavailable', errorCode })
  }

  private update(next: AxiomSnapshot): void {
    const normalized = { ...next, revision: this.current.revision }
    if (JSON.stringify(normalized) === JSON.stringify(this.current)) return
    this.current = { ...normalized, revision: this.current.revision + 1 }
    this.publish(this.current)
  }

  private schedule(generation: number): void {
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return
      void this.snapshot().finally(() => { if (generation === this.generation) this.schedule(generation) })
    }, 750)
    this.timer.unref()
  }
}
