/** A separately owned read-only page keeps older-message scrolling away from the live composer. */
import { z } from 'zod'
import type { AxiomHistoryPage } from './axiom-protocol.ts'
import type { AxiomWebsiteWindow } from './axiom-window.ts'
import { axiomConversationUrl } from './axiom-navigation.ts'
import { readAxiomHistoryPage, readAxiomPage } from './axiom-page.ts'

const observationSchema = z.object({
  url: z.string().max(4096), supported: z.boolean(), anchorFound: z.boolean(), hasEarlier: z.boolean(), startVerified: z.boolean(),
  messages: z.array(z.object({ id: z.string().min(1).max(512), role: z.enum(['user', 'assistant']),
    text: z.string().max(32768), timestamp: z.string().max(100).nullable(), truncated: z.boolean() }).strict()).max(100),
}).strict().refine(value => value.messages.reduce((total, message) => total + message.text.length, 0) <= 131072)
const unavailable = (): AxiomHistoryPage => ({ messages: [], hasMore: true, status: 'unavailable' })

/** One hidden source page and one bounded read/scroll operation, independent of live-page sends. */
export class DesktopAxiomHistory {
  private source: string | null = null
  private page: AxiomWebsiteWindow | undefined
  private generation = 0
  private documentEpoch = 0
  private read: Promise<unknown> | undefined
  private active: { id: string; controller: AbortController; result: Promise<AxiomHistoryPage> } | undefined

  /** @param create Creates a hidden isolated page in the existing website-owned authentication partition. */
  constructor(private readonly create: () => AxiomWebsiteWindow) {}

  /**
   * @param url Exact currently selected canonical Dot.
   * @param beforeId Stable original row preceding which older history is requested.
   * @returns A bounded older source page; missing boundary evidence and timeouts never claim exhaustion.
   */
  before(url: string, beforeId: string): Promise<AxiomHistoryPage> {
    if (typeof beforeId !== 'string' || beforeId.length === 0 || beforeId.length > 512) return Promise.resolve(unavailable())
    const selected = axiomConversationUrl(url)
    if (selected !== this.source) { this.disconnect(); this.source = selected }
    if (this.active) return this.active.id === beforeId ? this.active.result : Promise.resolve(unavailable())
    // A timed-out renderer read is still owned until it settles; do not queue more execution behind it.
    if (this.read) return Promise.resolve(unavailable())
    const controller = new AbortController()
    const generation = this.generation
    const result = this.collect(selected, beforeId, generation, controller.signal).catch((_unavailableHistory: unknown) => unavailable())
    const active = { id: beforeId, controller, result }
    this.active = active
    void result.finally(() => { if (this.active === active) this.active = undefined })
    return result
  }

  /** Revoke all queued observations and destroy only the owned history page, retaining website login state. */
  disconnect(): void {
    this.generation++
    this.active?.controller.abort()
    this.active = undefined
    this.read = undefined
    const page = this.page
    this.page = undefined
    this.source = null
    if (page && !page.window.isDestroyed()) page.window.destroy()
  }

  private open(url: string): AxiomWebsiteWindow {
    const page = this.create()
    this.page = page
    page.contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    page.contents.once('destroyed', () => { if (this.page === page) this.disconnect() })
    page.contents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument && this.page === page) { this.documentEpoch++; this.read = undefined }
    })
    const allowed = (value: string): boolean => {
      try { return axiomConversationUrl(value) === url } catch (_differentDocument: unknown) { return false }
    }
    page.contents.on('will-frame-navigate', (event) => { if (event.isMainFrame && !allowed(event.url)) event.preventDefault() })
    page.contents.on('will-redirect', (event, target, _inPlace, mainFrame) => { if (mainFrame && !allowed(target)) event.preventDefault() })
    page.contents.on('will-attach-webview', (event) => { event.preventDefault() })
    void page.contents.loadURL(url).catch((_historyLoadFailure: unknown) => {
      if (this.page === page) { this.page = undefined; if (!page.window.isDestroyed()) page.window.destroy() }
    })
    return page
  }

  private async collect(url: string, beforeId: string, generation: number, signal: AbortSignal): Promise<AxiomHistoryPage> {
    const page = this.page ?? this.open(url)
    const deadline = Date.now() + 20000
    let scrolled = false
    while (Date.now() < deadline) {
      if (signal.aborted || generation !== this.generation || this.page !== page || page.window.isDestroyed()) return unavailable()
      const currentUrl = page.contents.getURL()
      if (currentUrl !== '' && currentUrl !== 'about:blank' && currentUrl.replace(/\/$/u, '') !== url) return unavailable()
      if (currentUrl.replace(/\/$/u, '') === url && !page.contents.isLoading()) {
        const script = `(${readAxiomHistoryPage.toString()})(${readAxiomPage.toString()},${JSON.stringify(url)},${JSON.stringify(beforeId)},${scrolled})`
        const epoch = this.documentEpoch
        const reading = page.contents.executeJavaScript(script)
        this.read = reading
        const settled = (): void => { if (this.read === reading) this.read = undefined }
        void reading.then(settled, settled)
        const observation = observationSchema.parse(await this.bounded(reading, Math.min(5000, deadline - Date.now()), signal))
        signal.throwIfAborted()
        if (generation !== this.generation || this.page !== page || epoch !== this.documentEpoch
          || observation.url !== url || page.contents.getURL().replace(/\/$/u, '') !== url) return unavailable()
        if (observation.supported && observation.anchorFound) {
          if (observation.messages.length > 0) return { messages: observation.messages,
            hasMore: observation.hasEarlier || !observation.startVerified, status: 'ready' }
          if (observation.startVerified) return { messages: [], hasMore: false, status: 'ready' }
        }
        // A fresh page may not have mounted the requested older cursor yet. Use only the site's scroller.
        if (observation.supported) scrolled = true
      }
      await this.pause(signal)
    }
    return unavailable()
  }

  private bounded<T>(promise: Promise<T>, milliseconds: number, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Original history observation timed out')) }, milliseconds)
      const abort = (): void => { reject(new Error('Original history observation cancelled')) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      void promise.then(resolve, reject).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', abort) })
    })
  }

  private pause(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = (): void => { clearTimeout(timer); reject(new Error('Original history observation cancelled')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 250)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
}
