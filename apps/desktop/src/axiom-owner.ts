/** Select one original-page transport without changing the Host's native conversation operations. */
import type { AxiomHistoryPage, AxiomPreferences, AxiomSelection, AxiomSendResult, AxiomSnapshot, AxiomTransportMode } from './axiom-protocol.ts'
import { axiomConversationUrl } from './axiom-navigation.ts'
import { axiomPreferencesSchema, axiomSelectionSchema } from './axiom-transport-setting.ts'

/** Page owner implemented by both isolated Electron and explicitly paired regular-browser pages. */
export interface AxiomPageOwner {
  /** @param url Exact selected Dot. @param signal Owner cancellation. @returns Current original-page state. */
  connect(url: unknown, signal?: AbortSignal): Promise<AxiomSnapshot>
  /** @param hintUrl Known Dot, or null for explicit original-site selection. @returns Sanitized source state. */
  choose(hintUrl: string | null): Promise<AxiomSnapshot>
  /** @param beforeId Stable original cursor. @returns Earlier source messages or a retryable unavailable result. */
  historyBefore(beforeId: string): Promise<AxiomHistoryPage>
  /** @returns Current bounded original-page observations. */
  snapshot(): Promise<AxiomSnapshot>
  /**
   * @param value Explicit original text and revision.
   * @param signal Prevents further input where still possible.
   * @returns Original acknowledgement or uncertainty.
   */
  send(value: unknown, signal?: AbortSignal): Promise<AxiomSendResult>
  /** @returns After revealing only the original browser page. */
  showLogin(): void | Promise<void>
  /** Revoke observation; already-dispatched browser input cannot be undone or assumed stopped. */
  disconnect(): void
}

/** One selected original page transport; a mode switch cannot overtake a delivered send. */
export class DesktopAxiomOwner implements AxiomPageOwner {
  private sends = 0
  private choices: AxiomPreferences
  /**
   * @param owners Original page implementations.
   * @param mode Initial saved product choice.
   * @param persist Atomic transport writer; failure leaves the current owner unchanged.
   * @param preferences Initial feature choices; absent means enabled without a sidebar row.
   * @param persistPreferences Atomic feature writer; absent keeps choices in memory.
   * @param savedSelection Last observed source identity; absent means unselected.
   * @param persistSelection Atomic selection writer; absent keeps source identity in memory.
   */
  constructor(private readonly owners: Readonly<Record<AxiomTransportMode, AxiomPageOwner>>, private mode: AxiomTransportMode,
    private readonly persist?: (mode: AxiomTransportMode) => void,
    preferences: AxiomPreferences = { enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' },
    private readonly persistPreferences?: (value: AxiomPreferences) => void,
    private savedSelection: AxiomSelection | null = null,
    private readonly persistSelection?: (value: AxiomSelection) => void) { this.choices = { ...preferences } }
  /** @returns The last actual observed source identity without reading website content. */
  selection(): AxiomSelection | null { return this.savedSelection === null ? null : { ...this.savedSelection } }
  /** @param snapshot Actual original-page observation; only ready canonical pages can change the saved selection. */
  observe(snapshot: AxiomSnapshot): void {
    if (!this.choices.enabled || snapshot.phase !== 'ready') return
    const parsed = axiomSelectionSchema.safeParse({ url: snapshot.url, title: snapshot.title })
    if (!parsed.success) return
    const value = parsed.data
    if (this.savedSelection?.url === value.url && this.savedSelection.title === value.title) return
    this.persistSelection?.(value)
    this.savedSelection = value
  }
  /** @returns Initial loading/source state when enabled and selected; otherwise no page is opened. */
  async resume(): Promise<AxiomSnapshot | null> {
    if (!this.choices.enabled || this.savedSelection === null) return null
    return this.owners[this.mode].connect(this.savedSelection.url)
  }
  /** @returns Feature choices without reading website state. */
  preferences(): AxiomPreferences { return { ...this.choices } }
  /** @param value Exact feature choices; refuses changes during an outstanding original send. */
  setPreferences(value: unknown): void {
    const choices = axiomPreferencesSchema.parse(value)
    this.assertNoSend()
    if (choices.enabled === this.choices.enabled && choices.showInSidebar === this.choices.showInSidebar
      && choices.sidebarStyle === this.choices.sidebarStyle) return
    this.persistPreferences?.(choices)
    this.choices = choices
    if (!choices.enabled) { this.owners.browser.disconnect(); this.owners.embedded.disconnect() }
  }
  /** @returns The selected transport without reading browser state. */
  transport(): AxiomTransportMode { return this.mode }
  /** @param mode New original-page transport; rejects unknown choices or a send still awaiting acknowledgement. */
  selectTransport(mode: unknown): void {
    if (mode !== 'browser' && mode !== 'embedded') throw new Error('Unknown original-page transport')
    this.assertNoSend()
    if (mode === this.mode) return
    this.persist?.(mode)
    this.owners[this.mode].disconnect()
    this.mode = mode
  }
  connect(url: unknown, signal?: AbortSignal): Promise<AxiomSnapshot> {
    this.assertEnabled()
    if (this.savedSelection && axiomConversationUrl(url) !== this.savedSelection.url) return this.snapshot()
    return this.owners[this.mode].connect(url, signal)
  }
  async choose(hintUrl: string | null): Promise<AxiomSnapshot> {
    this.assertEnabled()
    this.assertNoSend()
    return this.owners[this.mode].choose(this.savedSelection?.url ?? hintUrl)
  }
  snapshot(): Promise<AxiomSnapshot> {
    return this.choices.enabled ? this.owners[this.mode].snapshot() : Promise.resolve({ source: 'chatgpt-web', url: null,
      title: '', revision: 0, phase: 'disconnected', messages: [], canSend: false, draftPresent: false, siteStatus: null, limited: true })
  }
  async historyBefore(beforeId: string): Promise<AxiomHistoryPage> {
    if (!this.choices.enabled || typeof beforeId !== 'string' || beforeId.length === 0 || beforeId.length > 512) {
      return { messages: [], hasMore: true, status: 'unavailable' }
    }
    return this.owners[this.mode].historyBefore(beforeId)
  }
  async send(value: unknown, signal?: AbortSignal): Promise<AxiomSendResult> {
    this.assertEnabled()
    this.sends++
    try { return await this.owners[this.mode].send(value, signal) } finally { this.sends-- }
  }
  async showLogin(): Promise<void> { this.assertEnabled(); await this.owners[this.mode].showLogin() }
  disconnect(): void { this.owners.browser.disconnect(); this.owners.embedded.disconnect() }
  private assertEnabled(): void { if (!this.choices.enabled) throw new Error('Dot is disabled in settings') }
  private assertNoSend(): void {
    if (this.sends > 0) throw new Error('Wait for the original message acknowledgement before changing its connection')
  }
}
