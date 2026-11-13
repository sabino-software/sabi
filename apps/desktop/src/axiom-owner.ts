/** Select one original-page transport without changing the Host's native conversation operations. */
import type { AxiomPreferences, AxiomSendResult, AxiomSnapshot, AxiomTransportMode } from './axiom-protocol.ts'
import { axiomPreferencesSchema } from './axiom-transport-setting.ts'

/** Page owner implemented by both isolated Electron and explicitly paired regular-browser pages. */
export interface AxiomPageOwner {
  /** @param url Exact selected Dot. @param signal Owner cancellation. @returns Current original-page state. */
  connect(url: unknown, signal?: AbortSignal): Promise<AxiomSnapshot>
  /** @param hintUrl Known Dot, or null for explicit original-site selection. @returns Sanitized source state. */
  choose(hintUrl: string | null): Promise<AxiomSnapshot>
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
   */
  constructor(private readonly owners: Readonly<Record<AxiomTransportMode, AxiomPageOwner>>, private mode: AxiomTransportMode,
    private readonly persist?: (mode: AxiomTransportMode) => void,
    preferences: AxiomPreferences = { enabled: true, showInSidebar: false },
    private readonly persistPreferences?: (value: AxiomPreferences) => void) { this.choices = { ...preferences } }
  /** @returns Feature choices without reading website state. */
  preferences(): AxiomPreferences { return { ...this.choices } }
  /** @param value Exact feature choices; refuses changes during an outstanding original send. */
  setPreferences(value: unknown): void {
    const choices = axiomPreferencesSchema.parse(value)
    this.assertNoSend()
    if (choices.enabled === this.choices.enabled && choices.showInSidebar === this.choices.showInSidebar) return
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
    return this.owners[this.mode].connect(url, signal)
  }
  async choose(hintUrl: string | null): Promise<AxiomSnapshot> {
    this.assertEnabled()
    this.assertNoSend()
    return this.owners[this.mode].choose(hintUrl)
  }
  snapshot(): Promise<AxiomSnapshot> {
    return this.choices.enabled ? this.owners[this.mode].snapshot() : Promise.resolve({ source: 'chatgpt-web', url: null,
      title: '', revision: 0, phase: 'disconnected', messages: [], canSend: false, draftPresent: false, siteStatus: null, limited: true })
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
