/** ACK-confirmed original user bodies remain available when background layout omits their text. */
import type { AxiomPageState } from './axiom-page.ts'
import type { AxiomMessage } from './axiom-protocol.ts'

type ObservedPage = Omit<AxiomPageState, 'sourceOrder'> & { readonly sourceOrder?: readonly string[] | undefined }

/** Bounded acknowledged user bodies for one original page lifetime. */
export class AxiomConfirmedMessages {
  private readonly messages = new Map<string, AxiomMessage>()

  /**
   * @param id Committed original ID returned by the current page's acknowledgement reader.
   * @param text Exact authored text acknowledged there.
   */
  record(id: string, text: string): void {
    const escaped = text.replaceAll(/([\\`*_[\]<>|~])/gu, '\\$1')
    this.messages.delete(id)
    this.messages.set(id, { id, role: 'user', text: escaped.slice(0, 32768), timestamp: null, truncated: escaped.length > 32768 })
    if (this.messages.size > 100) {
      const oldest = this.messages.keys().next().value
      if (oldest !== undefined) this.messages.delete(oldest)
    }
  }

  /** Revoke bodies with their owning page lifecycle. */
  clear(): void { this.messages.clear() }

  /** @param state Current original DOM observation. @returns Bounded bodies in observed order; actual DOM bodies take precedence. */
  project(state: ObservedPage): ObservedPage {
    const order = state.sourceOrder
    const bodies = new Map(state.messages.map(message => [message.id, message]))
    if (order === undefined || state.messages.some(message => !order.includes(message.id))
      || !order.some(id => !bodies.has(id) && this.messages.has(id))) return state
    const messages: AxiomMessage[] = []
    let remaining = 131072
    let limited = state.limited
    for (const id of [...new Set(order)].reverse()) {
      const body = bodies.get(id) ?? this.messages.get(id)
      if (body === undefined) continue
      const text = body.text.slice(0, Math.min(32768, remaining))
      const truncated = body.truncated || text.length !== body.text.length
      limited ||= truncated
      remaining -= text.length
      if (text !== '') messages.push({ ...body, text, truncated })
    }
    return { ...state, messages: messages.reverse(), limited }
  }
}
