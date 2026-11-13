/** Original regular-browser page ownership over a private, explicitly paired native-messaging connection. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AxiomHistoryPage, AxiomSendResult, AxiomSnapshot } from './axiom-protocol.ts'
import { axiomConversationUrl } from './axiom-navigation.ts'
import { BrowserFrameDecoder, encodeBrowserFrame } from './axiom-browser-framing.ts'
import { browserAuthenticationSchema, browserPairSchema, browserResponseSchema, browserSendResultSchema,
  browserSendSchema, browserSnapshotSchema, type BrowserAxiomPair } from './axiom-browser-protocol.ts'

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** Native integration callbacks never expose website authentication state or an arbitrary browser command. */
export interface BrowserAxiomOptions {
  readonly directory: string
  readonly confirm: (pair: BrowserAxiomPair) => Promise<boolean>
  readonly openExternal: (url: string) => Promise<void>
  readonly publish: (snapshot: AxiomSnapshot) => void
  readonly requestTimeoutMs?: number
  readonly pairingNotice?: () => string
}

function empty(url: string | null, phase: AxiomSnapshot['phase']): AxiomSnapshot {
  return { source: 'chatgpt-web', url, title: '', revision: 0, phase, messages: [], canSend: false,
    draftPresent: false, siteStatus: null, limited: true }
}

/** One exact selected Dot; only an approved extension tab can produce its original-page snapshots. */
export class BrowserAxiomPage {
  private disposed = false
  private epoch = 0
  private selected: string | null = null
  private current = empty(null, 'disconnected')
  private server: Server | undefined
  private starting: Promise<void> | undefined
  private stopStarting: (() => void) | undefined
  private temporary: string | undefined
  private key: string | undefined
  private peer: { socket: Socket; pairId: string; tabId: number; documentId: string } | undefined
  private pairing = false
  private choosing = false
  private nextId = 1
  private readonly sockets = new Set<Socket>()
  private readonly pending = new Map<number, Pending>()
  private readonly usedRequests = new Set<string>()
  private readonly submissions = new Map<string, { digest: string; result: Promise<AxiomSendResult> }>()

  /** @param options Private profile directory and explicit native user actions. */
  constructor(private readonly options: BrowserAxiomOptions) {}

  /** @param value Exact selected Dot. @param signal Owner cancellation. @returns Current source state or pairing-required state. */
  async connect(value: unknown, signal?: AbortSignal): Promise<AxiomSnapshot> {
    signal?.throwIfAborted()
    if (this.disposed) throw new Error('Original browser bridge is closed')
    const url = axiomConversationUrl(value)
    if (this.choosing) {
      if (this.selected !== url) return this.snapshot()
      this.choosing = false
    }
    if (this.selected !== url) { this.disconnect(); this.selected = url }
    const epoch = this.epoch
    await this.start()
    signal?.throwIfAborted()
    if (epoch !== this.epoch) return this.current
    if (this.peer) return this.snapshot()
    this.update({ ...empty(url, 'login-required'), siteStatus: this.options.pairingNotice?.() ?? 'Open this Dot in your regular browser, then click the Sabi extension to connect it.' })
    return this.current
  }

  /**
   * @param hintUrl Known canonical Dot, or null to admit one toolbar-selected Dot after native confirmation.
   * @returns Current safe state.
   */
  async choose(hintUrl: string | null): Promise<AxiomSnapshot> {
    if (hintUrl !== null) {
      const url = axiomConversationUrl(hintUrl)
      if (this.selected === url && this.peer && this.current.phase === 'ready') return this.snapshot()
      this.disconnect()
      const state = await this.connect(url)
      if (this.selected === url) this.choosing = true
      return state
    }
    if (this.peer && this.current.phase === 'ready') return this.snapshot()
    if (this.disposed) throw new Error('Original browser bridge is closed')
    this.disconnect()
    this.choosing = true
    const epoch = this.epoch
    await this.start()
    if (epoch !== this.epoch) return this.current
    this.update({ ...empty(null, 'login-required'), siteStatus: this.options.pairingNotice?.() ?? 'Open your Dot in your regular browser, then click the Sabi extension to select it.' })
    return this.current
  }

  /** @returns Bounded observations of the bound main document; authentication pages are never observed. */
  async snapshot(): Promise<AxiomSnapshot> {
    if (!this.peer) return this.current
    try {
      const snapshot = this.validateSnapshot(await this.request('snapshot', {}))
      this.update(snapshot)
    } catch (_unavailableBrowser: unknown) {
      this.update(empty(this.selected, this.selected === null ? 'disconnected' : 'login-required'))
    }
    return this.current
  }

  /**
   * @param value Explicit original text and observed revision.
   * @param signal Prevents input before delivery.
   * @returns Confirmed or uncertain source acknowledgement; never resends.
   */
  send(value: unknown, signal?: AbortSignal): Promise<AxiomSendResult> {
    const parsed = browserSendSchema.safeParse(value)
    if (!parsed.success || signal?.aborted || !this.peer) return Promise.resolve({ status: 'refused', snapshot: this.current })
    const request = parsed.data
    const digest = createHash('sha256').update(request.text).digest('hex')
    const prior = this.submissions.get(request.requestId)
    if (prior) return prior.digest === digest ? prior.result : Promise.resolve({ status: 'refused', snapshot: this.current })
    if (this.usedRequests.has(request.requestId)) return Promise.resolve({ status: 'refused', snapshot: this.current })
    this.usedRequests.add(request.requestId)
    if (this.submissions.size >= 32) {
      const oldest = this.submissions.keys().next().value
      if (oldest !== undefined) this.submissions.delete(oldest)
    }
    const beforeIds = new Set(this.current.messages.map(message => message.id))
    // Once delivered, cancellation cannot undo browser input. Await acknowledgement or the bounded deadline.
    const result = this.request('send', { request }).then((value) => {
      const sent = browserSendResultSchema.parse(value)
      const snapshot = this.validateSnapshot(sent.snapshot)
      if (sent.status === 'confirmed' && (sent.messageId === undefined || beforeIds.has(sent.messageId)
        || !snapshot.messages.some(message => message.id === sent.messageId && message.role === 'user'))) throw new Error('Missing original user acknowledgement')
      this.update(snapshot)
      return { status: sent.status, snapshot, ...sent.messageId === undefined ? {} : { messageId: sent.messageId } }
    }).catch((_unconfirmedSend: unknown): AxiomSendResult => ({ status: 'unknown', snapshot: this.current }))
    this.submissions.set(request.requestId, { digest, result })
    return result
  }

  /**
   * @param _beforeId Source cursor.
   * @returns Explicitly unsupported history without expanding extension permissions or moving the live tab.
   */
  historyBefore(_beforeId: string): Promise<AxiomHistoryPage> {
    return Promise.resolve({ messages: [], hasMore: true, status: 'unavailable' })
  }

  /** Reveal only the selected regular-browser Dot, leaving its normal login flow under browser ownership. */
  async showLogin(): Promise<void> {
    if (this.selected === null) {
      if (!this.choosing) throw new Error('Select the original Dot first')
      await this.options.openExternal('https://chatgpt.com/')
      return
    }
    if (this.peer) await this.request('show', {})
    else await this.options.openExternal(this.selected)
  }

  /** Revoke the selected browser connection without closing its tab or changing its website login. */
  disconnect(): void {
    this.epoch++
    this.pairing = false
    this.choosing = false
    this.selected = null
    for (const socket of this.sockets) socket.destroy()
    this.peer?.socket.destroy()
    this.peer = undefined
    this.rejectPending()
    this.update(empty(null, 'disconnected'))
  }

  /** Close private listeners and remove only this process's descriptor and temporary socket directory. */
  dispose(): void {
    this.disposed = true
    this.disconnect()
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.stopStarting?.()
    this.server?.close(() => {})
    this.server = undefined
    const descriptor = join(this.options.directory, 'connection.json')
    if (this.key && existsSync(descriptor)) {
      try { if ((JSON.parse(readFileSync(descriptor, 'utf8')) as { key?: unknown }).key === this.key) unlinkSync(descriptor) }
      catch (_staleDescriptor: unknown) { /* A replacement descriptor belongs to its new owner. */ }
    }
    if (this.temporary) rmSync(this.temporary, { recursive: true, force: true })
    this.temporary = undefined
    this.key = undefined
  }

  private validateSnapshot(value: unknown): AxiomSnapshot {
    const parsed = browserSnapshotSchema.parse(value)
    if (parsed.url !== this.selected || parsed.url === null || axiomConversationUrl(parsed.url) !== this.selected) throw new Error('Wrong browser document')
    if (parsed.phase !== 'ready' && (parsed.messages.length > 0 || parsed.canSend)) throw new Error('Unavailable pages cannot export messages')
    const { errorCode, ...snapshot } = parsed
    return { ...snapshot, ...errorCode === undefined ? {} : { errorCode } }
  }

  private update(snapshot: AxiomSnapshot): void { this.current = snapshot; this.options.publish(snapshot) }

  private start(): Promise<void> {
    this.starting ??= this.listen().catch((error: unknown) => { this.dispose(); throw error })
    return this.starting
  }

  private async listen(): Promise<void> {
    mkdirSync(this.options.directory, { recursive: true, mode: 0o700 })
    const info = lstatSync(this.options.directory)
    const uid = process.getuid?.()
    if (uid === undefined || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== uid) throw new Error('Browser bridge requires a private profile directory')
    const temporary = mkdtempSync(join(tmpdir(), 'skeinlet-axiom-'))
    chmodSync(temporary, 0o700)
    this.temporary = temporary
    const socketPath = join(temporary, 'bridge.sock')
    const server = createServer((socket) => { this.accept(socket) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        this.stopStarting = undefined
        server.off('error', fail)
        if (error) reject(error)
        else resolve()
      }
      const fail = (error: Error): void => { finish(error) }
      this.stopStarting = () => { finish(new Error('Original browser bridge is closed')) }
      server.once('error', fail)
      server.listen(socketPath, () => { finish() })
    })
    if (this.disposed) { server.close(); throw new Error('Original browser bridge is closed') }
    server.on('error', () => { this.dispose() })
    server.unref()
    chmodSync(socketPath, 0o600)
    this.key = randomBytes(32).toString('hex')
    const descriptor = join(this.options.directory, 'connection.json')
    // This feature owns only this descriptor; never follow an existing link while replacing it.
    if (existsSync(descriptor)) {
      const old = lstatSync(descriptor)
      if (!old.isFile() || old.isSymbolicLink() || old.uid !== uid) throw new Error('Invalid browser bridge descriptor')
      unlinkSync(descriptor)
    }
    writeFileSync(descriptor, JSON.stringify({ socketPath, key: this.key }), { flag: 'wx', mode: 0o600 })
  }

  private accept(socket: Socket): void {
    if (this.sockets.size >= 8) { socket.destroy(); return }
    socket.unref()
    this.sockets.add(socket)
    const decoder = new BrowserFrameDecoder()
    let authenticated = false
    let offered = false
    const deadline = setTimeout(() => { socket.destroy() }, 5000)
    deadline.unref()
    socket.on('error', () => { socket.destroy() })
    socket.on('close', () => {
      clearTimeout(deadline)
      this.sockets.delete(socket)
      if (this.peer?.socket === socket) {
        this.peer = undefined
        this.rejectPending()
        this.update(empty(this.selected, this.selected === null ? 'disconnected' : 'login-required'))
      }
    })
    socket.on('data', (bytes) => {
      try { decoder.push(bytes, (value) => {
        if (!authenticated) {
          const auth = browserAuthenticationSchema.parse(value)
          if (!this.key || !timingSafeEqual(Buffer.from(auth.key), Buffer.from(this.key))) throw new Error('Unpaired helper')
          authenticated = true
          return
        }
        if (!offered) {
          offered = true
          clearTimeout(deadline)
          const pair = browserPairSchema.parse(value)
          const url = axiomConversationUrl(pair.url)
          const unboundChoice = this.choosing && this.selected === null
          if (this.pairing || pair.url !== url || (!unboundChoice && url !== this.selected)) throw new Error('Unselected browser page')
          this.pairing = true
          const selected = this.selected
          const epoch = this.epoch
          void this.options.confirm(pair).then((approved) => {
            if (!approved || this.epoch !== epoch || this.disposed || this.selected !== selected || socket.destroyed) {
              socket.destroy()
              return
            }
            this.peer?.socket.destroy()
            this.selected = url
            const pairId = randomBytes(16).toString('hex')
            this.peer = { socket, pairId, tabId: pair.tabId, documentId: pair.documentId }
            socket.write(encodeBrowserFrame({ type: 'paired', version: 1, pairId, url }))
            void this.snapshot()
          }).catch((_pairingUnavailable: unknown) => { socket.destroy() }).finally(() => { if (this.epoch === epoch) this.pairing = false })
          return
        }
        const reply = browserResponseSchema.parse(value)
        if (this.peer?.socket !== socket || reply.pairId !== this.peer.pairId) throw new Error('Wrong browser pairing')
        const pending = this.pending.get(reply.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(reply.id)
        if (reply.ok) pending.resolve(reply.value)
        else pending.reject(new Error('Original browser page is unavailable'))
      }) } catch (_invalidBrowserMessage: unknown) { socket.destroy() }
    })
  }

  private request(method: 'snapshot' | 'send' | 'show', args: object): Promise<unknown> {
    const peer = this.peer
    if (!peer || peer.socket.destroyed || this.pending.size >= 16 || !Number.isSafeInteger(this.nextId)) return Promise.reject(new Error('Original browser page is unavailable'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); peer.socket.destroy(); reject(new Error('Original browser outcome is unconfirmed')) }, this.options.requestTimeoutMs ?? 20000)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      try {
        if (peer.socket.writableLength > 4 * 1024 * 1024) throw new Error('Browser bridge backpressure')
        peer.socket.write(encodeBrowserFrame({ type: 'request', id, pairId: peer.pairId, method, args }))
      } catch (_undeliveredRequest: unknown) { this.pending.delete(id); clearTimeout(timer); peer.socket.destroy(); reject(new Error('Original browser outcome is unconfirmed')) }
    })
  }

  private rejectPending(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Original browser connection closed')) }
    this.pending.clear()
  }
}
