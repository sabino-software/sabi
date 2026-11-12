/** Select one original-page transport without changing the Host's native conversation operations. */
import type { AxiomSendResult, AxiomSnapshot, AxiomTransportMode } from './axiom-protocol.ts'

/** Page owner implemented by both isolated Electron and explicitly paired regular-browser pages. */
export interface AxiomPageOwner {
  /** @param url Exact selected Dot. @param signal Owner cancellation. @returns Current original-page state. */
  connect(url: unknown, signal?: AbortSignal): Promise<AxiomSnapshot>
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
  /**
   * @param owners Original page implementations.
   * @param mode Initial saved product choice.
   * @param persist Atomic preference writer; failure leaves the current owner unchanged.
   */
  constructor(private readonly owners: Readonly<Record<AxiomTransportMode, AxiomPageOwner>>, private mode: AxiomTransportMode,
    private readonly persist?: (mode: AxiomTransportMode) => void) {}
  /** @returns The selected transport without reading browser state. */
  transport(): AxiomTransportMode { return this.mode }
  /** @param mode New original-page transport; rejects unknown choices or a send still awaiting acknowledgement. */
  selectTransport(mode: unknown): void {
    if (mode !== 'browser' && mode !== 'embedded') throw new Error('Unknown original-page transport')
    if (this.sends > 0) throw new Error('Wait for the original message acknowledgement before changing its connection')
    if (mode === this.mode) return
    this.persist?.(mode)
    this.owners[this.mode].disconnect()
    this.mode = mode
  }
  connect(url: unknown, signal?: AbortSignal): Promise<AxiomSnapshot> { return this.owners[this.mode].connect(url, signal) }
  snapshot(): Promise<AxiomSnapshot> { return this.owners[this.mode].snapshot() }
  async send(value: unknown, signal?: AbortSignal): Promise<AxiomSendResult> {
    this.sends++
    try { return await this.owners[this.mode].send(value, signal) } finally { this.sends-- }
  }
  async showLogin(): Promise<void> { await this.owners[this.mode].showLogin() }
  disconnect(): void { this.owners[this.mode].disconnect() }
}
