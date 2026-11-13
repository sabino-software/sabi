/** Persistent original-site page ownership; Harness renders only bounded DOM projections. */
import { type BrowserWindow, dialog, session, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AxiomSendRequest, AxiomSendResult, AxiomSnapshot } from './axiom-protocol.ts'
import { readAxiomPage, focusAxiomComposer, clickAxiomSend, findAxiomAcknowledgement } from './axiom-page.ts'
import { createAxiomWebsiteWindow } from './axiom-window.ts'
import { axiomChooserNavigation, axiomConversationUrl, axiomNavigation, type AxiomNavigation } from './axiom-navigation.ts'

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
  private choosing = false
  private pendingChoice = false
  private current = initialSnapshot()
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshing: Promise<AxiomSnapshot> | undefined
  private sending = false
  private closedByUser = false
  private returnAfterChoice = false
  private readyUntil = 0
  private documentEpoch = 0
  private pageRead: { page: BrowserWindow; generation: number; documentEpoch: number; promise: Promise<unknown> } | undefined
  private readonly websiteContents = new WeakMap<BrowserWindow, WebContents>()
  private sessionConfigured = false
  private authenticating = false
  private loginRevealed = false
  private navigationIssue: string | null = null
  private warningPending = false
  private readonly loginPopups = new Set<BrowserWindow>()
  private readonly submissions = new Map<string, { digest: string; pending?: Promise<AxiomSendResult>; outcome?: Pick<AxiomSendResult, 'status' | 'messageId'> }>()

  /**
   * @param publish Sends safe projections only to the owned application renderer.
   * @param locale Toolbar locale; absent uses English.
   * @param revealNative Reveals native chat only when a completed chooser held focus.
   */
  constructor(private readonly publish: (snapshot: AxiomSnapshot) => void, private readonly locale: () => string = () => 'en',
    private readonly revealNative?: () => void) {}

  /**
   * Open a directly selected conversation in its dedicated persistent original-site session.
   * @param value Exact conversation URL selected by the user.
   * @param signal Optional owning Host cancellation; an aborted call cannot replace the selected page.
   * @returns Initial bounded DOM projection; authentication remains in the original website.
   */
  async connect(value: unknown, signal?: AbortSignal): Promise<AxiomSnapshot> {
    signal?.throwIfAborted()
    const url = axiomConversationUrl(value)
    if (this.closedByUser) return this.current
    if (this.choosing || (this.pendingChoice && this.selected !== url)) return this.snapshot()
    this.pendingChoice = false
    if (this.selected === url && this.page !== undefined && !this.page.isDestroyed()) return this.snapshot()
    return this.open(url, false)
  }

  /**
   * @param hintUrl Known canonical Dot, or null to choose on the original website.
   * @returns Safe source state; sign-in content stays private.
   */
  async choose(hintUrl: string | null): Promise<AxiomSnapshot> {
    if (hintUrl !== null) {
      const url = axiomConversationUrl(hintUrl)
      this.closedByUser = false
      this.returnAfterChoice = true
      const state = this.selected === url && !this.choosing ? await this.snapshot() : await this.open(url, false, true)
      this.finishChoice(state)
      if (state.phase !== 'ready' && this.selected === url && this.page && !this.page.isDestroyed()) this.revealAuthentication()
      return state
    }
    this.closedByUser = false
    if (this.selected !== null && this.current.phase === 'ready' && this.page && !this.page.isDestroyed()) {
      this.returnAfterChoice = true
      const state = await this.snapshot()
      this.finishChoice(state)
      return state
    }
    return this.open(null, true)
  }

  private open(url: string | null, choosing: boolean, pendingChoice = false): Promise<AxiomSnapshot> {
    this.disconnect()
    this.selected = url
    this.choosing = choosing
    this.pendingChoice = pendingChoice
    this.returnAfterChoice = choosing || pendingChoice
    this.readyUntil = Date.now() + 30000
    this.loginRevealed = choosing
    const generation = this.generation
    const browserSession = session.fromPartition('persist:skeinlet-axiom')
    if (!this.sessionConfigured) {
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
      browserSession.setPermissionCheckHandler(() => false)
      browserSession.setDevicePermissionHandler(() => false)
      browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}) })
      browserSession.on('will-download', (event) => { event.preventDefault() })
      this.sessionConfigured = true
    }
    const created = createAxiomWebsiteWindow({ show: false, width: 1100, height: 800,
      webPreferences: { session: browserSession, nodeIntegration: false, nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
        backgroundThrottling: false, spellcheck: false },
    }, this.locale())
    const page = created.window
    this.websiteContents.set(page, created.contents)
    this.page = page
    const categoryOf = (target: string, window: BrowserWindow): AxiomNavigation | 'selection' => this.choosing
      ? axiomChooserNavigation(target, this.authenticating, this.loginRevealed && window.isVisible())
      : this.selected === null ? 'blocked' : axiomNavigation(target, this.selected, this.authenticating, this.loginRevealed && window.isVisible())
    const admit = (target: string, window: BrowserWindow): boolean => {
      const category = categoryOf(target, window)
      if (category === 'authentication') this.authenticating = true
      if (category === 'blocked') { this.blockedNavigation(window); return false }
      this.navigationIssue = null
      return true
    }
    this.contents(page).setWindowOpenHandler((details) => {
      if (this.page !== page || generation !== this.generation || !page.isVisible()
        || this.loginPopups.size > 0 || details.postBody !== undefined
        || categoryOf(details.url, page) !== 'authentication') {
        this.blockedNavigation(page)
        return { action: 'deny' }
      }
      this.authenticating = true
      this.navigationIssue = null
      return { action: 'allow', createWindow: (options) => {
        const popup = createAxiomWebsiteWindow(options, this.locale())
        this.websiteContents.set(popup.window, popup.contents)
        attachPopup(popup.window)
        return popup.contents
      }, overrideBrowserWindowOptions: { show: true, width: 600, height: 800,
        webPreferences: { session: browserSession, nodeIntegration: false, nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
          allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false },
      } }
    })
    const guardNavigation = (window: BrowserWindow): void => {
      this.contents(window).on('will-frame-navigate', (event) => {
        if (event.isMainFrame && !admit(event.url, window)) event.preventDefault()
      })
      this.contents(window).on('will-redirect', (event, target, _inPlace, mainFrame) => {
        if (mainFrame && !admit(target, window)) event.preventDefault()
      })
    }
    guardNavigation(page)
    const returnToSelected = (window: BrowserWindow): void => {
      if (this.page !== page || generation !== this.generation || window.isDestroyed()) return
      const observedUrl = this.contents(window).getURL()
      const category = categoryOf(observedUrl, window)
      if (this.choosing) {
        if (window !== page) {
          if (category === 'conversation' || category === 'selection' || category === 'return') {
            window.destroy()
            void this.contents(page).loadURL(category === 'conversation' ? axiomConversationUrl(observedUrl) : 'https://chatgpt.com/').catch((_chooserReturnFailure: unknown) => {
              if (this.page === page) this.unavailable('page-unavailable')
            })
          }
          return
        }
        if (category !== 'conversation') return
        this.selected = axiomConversationUrl(observedUrl)
        this.choosing = false
        this.pendingChoice = true
      }
      if (window === page && category === 'conversation') {
        this.readyUntil = Date.now() + 30000
        this.authenticating = false
        this.loginRevealed = false
        this.navigationIssue = null
        return
      }
      if (category !== 'return' && !(window !== page && category === 'conversation')) return
      this.authenticating = false
      this.loginRevealed = false
      this.navigationIssue = null
      if (window !== page) window.destroy()
      const selected = this.selected
      if (selected === null) return
      void this.contents(page).loadURL(selected).catch((_loginReturnFailure: unknown) => {
        if (this.page === page) this.unavailable('page-unavailable')
      })
    }
    const attachPopup = (popup: BrowserWindow): void => {
      if (this.page !== page || generation !== this.generation) { popup.destroy(); return }
      this.loginPopups.add(popup)
      guardNavigation(popup)
      this.contents(popup).setWindowOpenHandler(() => { this.blockedNavigation(popup); return { action: 'deny' } })
      this.contents(popup).on('will-attach-webview', (event) => { event.preventDefault() })
      this.contents(popup).on('did-finish-load', () => { returnToSelected(popup) })
      popup.once('closed', () => {
        this.loginPopups.delete(popup)
        if (this.page === page) void this.snapshot()
      })
    }
    this.contents(page).on('did-start-navigation', (event) => {
      if (this.page !== page || !event.isMainFrame || event.isSameDocument) return
      this.documentEpoch++
      this.pageRead = undefined
      this.refreshing = undefined
      this.readyUntil = Date.now() + 30000
      this.update({ ...initialSnapshot(), url: this.selected, phase: 'loading' })
    })
    this.contents(page).on('did-create-window', attachPopup)
    this.contents(page).on('did-finish-load', () => { returnToSelected(page) })
    this.contents(page).on('did-navigate-in-page', (_event, _url, mainFrame) => {
      if (!mainFrame || this.page !== page) return
      returnToSelected(page)
      void this.snapshot()
    })
    this.contents(page).on('will-attach-webview', (event) => { event.preventDefault() })
    this.contents(page).on('render-process-gone', () => { if (this.page === page) this.unavailable('page-unavailable') })
    page.once('closed', () => {
      if (this.page !== page) return
      this.closedByUser = true
      this.disconnect()
    })
    this.contents(page).on('did-finish-load', () => { if (this.page === page) void this.snapshot() })
    this.update({ ...initialSnapshot(), url, phase: 'loading' })
    if (choosing) page.show()
    void this.contents(page).loadURL(url ?? 'https://chatgpt.com/').catch((pageLoadFailure: unknown) => {
      if (pageLoadFailure instanceof Error && 'code' in pageLoadFailure && pageLoadFailure.code === 'ERR_ABORTED') return
      if (generation === this.generation) this.unavailable('page-unavailable')
    })
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
    this.returnAfterChoice = false
    this.revealAuthentication()
  }

  private revealAuthentication(): void {
    if (this.page === undefined || this.page.isDestroyed()) throw new Error('Connect an original conversation first')
    this.loginRevealed = true
    this.navigationIssue = null
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
    this.loginRevealed = false
    this.navigationIssue = null
    for (const popup of this.loginPopups) if (!popup.isDestroyed()) popup.destroy()
    this.loginPopups.clear()
    this.selected = null
    this.choosing = false
    this.pendingChoice = false
    this.returnAfterChoice = false
    this.readyUntil = 0
    this.pageRead = undefined
    if (page !== undefined && !page.isDestroyed()) page.destroy()
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
    void result.then((outcome) => {
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
    if (page === undefined || page.isDestroyed() || selected === null || !this.matches(this.contents(page).getURL())) {
      return { status: 'refused', snapshot: this.current }
    }
    this.sending = true
    let attemptedClick = false
    try {
      const state = await this.snapshot()
      if (signal?.aborted || generation !== this.generation || !state.canSend || state.draftPresent || !this.matches(this.contents(page).getURL())) return { status: 'refused', snapshot: state }
      const ids: unknown = await this.contents(page).executeJavaScript(
        "Array.from(document.querySelectorAll('article.message-row[data-message-id]'), row => row.getAttribute('data-message-id'))")
      const before = z.array(z.string().max(512)).max(10000).parse(ids)
      const focused: unknown = await this.contents(page).executeJavaScript(`(${focusAxiomComposer.toString()})()`, true)
      if (signal?.aborted || focused !== true || generation !== this.generation || !this.matches(this.contents(page).getURL())) return { status: 'refused', snapshot: this.current }
      await this.contents(page).insertText(request.text)
      if (signal?.aborted || generation !== this.generation || !this.matches(this.contents(page).getURL())) return { status: 'unknown', snapshot: this.current }
      attemptedClick = true
      const accepted: unknown = await this.contents(page).executeJavaScript(
        `location.href.replace(/\\/$/, '') === ${JSON.stringify(selected)} && (${clickAxiomSend.toString()})(${JSON.stringify(request.text)})`, true)
      if (accepted !== true) return { status: 'refused', snapshot: await this.snapshot() }
      const deadline = Date.now() + 12000
      while (!signal?.aborted && generation === this.generation && !page.isDestroyed()
        && this.matches(this.contents(page).getURL()) && Date.now() < deadline) {
        const id: unknown = await this.contents(page).executeJavaScript(
          `(${findAxiomAcknowledgement.toString()})(${JSON.stringify(request.text)},${JSON.stringify(before)})`)
        if (typeof id === 'string') return { status: 'confirmed', messageId: id, snapshot: await this.snapshot() }
        await new Promise<void>((resolve) => { setTimeout(resolve, 250) })
      }
      return { status: 'unknown', snapshot: await this.snapshot() }
    } catch (_pageSubmissionFailure) {
      return { status: attemptedClick ? 'unknown' : 'refused', snapshot: this.current }
    } finally { this.sending = false }
  }

  /** Reload only the focused owned website, including its current authentication popup. @returns Whether a page was reloaded. */
  reloadFocused(): boolean {
    for (const window of [...this.loginPopups, ...(this.page === undefined ? [] : [this.page])]) {
      if (!window.isDestroyed() && window.isFocused()) { this.contents(window).reload(); return true }
    }
    return false
  }

  private contents(window: BrowserWindow): WebContents { return this.websiteContents.get(window) ?? window.webContents }

  private matches(url: string): boolean {
    try { return axiomConversationUrl(url) === this.selected } catch (_differentPage) { return false }
  }

  private async read(generation: number): Promise<AxiomSnapshot> {
    const page = this.page
    const documentEpoch = this.documentEpoch
    if (page === undefined || page.isDestroyed()) return this.current
    if (this.navigationIssue !== null) {
      this.update({ ...initialSnapshot(), url: this.selected, phase: 'login-required',
        siteStatus: this.navigationIssue, errorCode: 'unsupported-page' })
      return this.current
    }
    if (this.choosing) {
      this.update({ ...initialSnapshot(), phase: 'login-required', limited: true })
      return this.current
    }
    if (this.loginPopups.size > 0 || !this.matches(this.contents(page).getURL())) {
      const currentUrl = this.contents(page).getURL()
      if (currentUrl === '' || currentUrl === 'about:blank') return this.current
      const category = this.selected === null ? 'blocked' : axiomNavigation(currentUrl, this.selected, this.authenticating, this.loginRevealed && page.isVisible())
      const loginPage = this.loginPopups.size > 0 || category === 'authentication' || category === 'return'
      this.update({ ...initialSnapshot(), url: this.selected, phase: loginPage ? 'login-required' : 'unavailable',
        ...loginPage ? {} : { errorCode: 'unsupported-page' as const } })
      return this.current
    }
    if (this.contents(page).isLoading()) {
      this.update({ ...initialSnapshot(), url: this.selected, phase: 'loading' })
      return this.current
    }
    if (this.pageRead?.page === page && this.pageRead.generation === generation
      && this.pageRead.documentEpoch === documentEpoch) return this.current
    try {
      const reading = { page, generation, documentEpoch, promise: this.contents(page).executeJavaScript(`(${readAxiomPage.toString()})()`) }
      this.pageRead = reading
      const settled = (): void => { if (this.pageRead === reading) this.pageRead = undefined }
      void reading.promise.then(settled, settled)
      const deadline = Promise.withResolvers<never>()
      const timer = setTimeout(() => { deadline.reject(new Error('Original page observation timed out')) }, 5000)
      let raw: unknown
      try { raw = await Promise.race([reading.promise, deadline.promise]) }
      finally { clearTimeout(timer) }
      const state = pageSchema.parse(raw)
      if (generation !== this.generation || documentEpoch !== this.documentEpoch
        || !this.matches(state.url) || !this.matches(this.contents(page).getURL())) return this.current
      this.update({ source: 'chatgpt-web', url: this.selected, title: state.title, revision: this.current.revision,
        phase: state.composer ? 'ready' : this.contents(page).isLoading() || Date.now() < this.readyUntil ? 'loading' : 'unavailable',
        messages: state.messages, canSend: state.composer && state.sendPresent, draftPresent: state.draft.trim() !== '',
        siteStatus: state.siteStatus, limited: state.limited })
      this.finishChoice(this.current)
    } catch (_unsupportedPage) {
      if (generation === this.generation && documentEpoch === this.documentEpoch) this.unavailable('unsupported-page')
    }
    return this.current
  }

  private finishChoice(snapshot: AxiomSnapshot): void {
    const page = this.page
    if (!this.returnAfterChoice || snapshot.phase !== 'ready' || snapshot.url !== this.selected
      || !page || page.isDestroyed() || this.loginPopups.size > 0) return
    this.returnAfterChoice = false
    const focused = page.isFocused()
    page.hide()
    if (focused) this.revealNative?.()
  }

  private blockedNavigation(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    const issue = 'This sign-in destination is not supported. Use your account’s original sign-in method; '
      + 'organization-specific sign-in may need support from your app administrator.'
    this.navigationIssue = issue
    this.update({ ...initialSnapshot(), url: this.selected, phase: 'login-required', siteStatus: issue, errorCode: 'unsupported-page' })
    if (!window.isVisible() || this.warningPending) return
    this.warningPending = true
    void Promise.resolve().then(() => dialog.showMessageBox(window, { type: 'warning', title: 'Sign-in navigation blocked',
      message: 'This sign-in destination is not supported by the app.', detail: issue, buttons: ['OK'],
    })).catch(() => {}).finally(() => { this.warningPending = false })
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
