/** Browser-safe projections and the owned transport to the original ChatGPT page. */
import type { NativeConversationId } from './types.ts'

/** One bounded, currently rendered original-site message. */
export interface AxiomMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp: string | null
  readonly truncated: boolean
}

/** Observed source-page state; no credentials or hidden history are included. */
export interface AxiomSnapshot {
  readonly source: 'chatgpt-web'
  readonly url: string | null
  readonly title: string
  readonly revision: number
  readonly phase: 'disconnected' | 'loading' | 'login-required' | 'ready' | 'unavailable'
  readonly messages: readonly AxiomMessage[]
  readonly canSend: boolean
  readonly draftPresent: boolean
  readonly siteStatus: string | null
  readonly limited: boolean
  readonly errorCode?: 'page-unavailable' | 'unsupported-page'
}

/** Exactly one original-site submission, never repeated after an ambiguous result. */
export interface AxiomSendRequest {
  readonly requestId: string
  readonly revision: number
  readonly text: string
}

/** Confirmation identifies the newly rendered original user message. */
export interface AxiomSendResult {
  readonly status: 'confirmed' | 'unknown' | 'refused'
  readonly snapshot: AxiomSnapshot
  readonly messageId?: string
}

/** One Host-only binding; the page URL never becomes model-visible context. */
export interface AxiomBinding {
  readonly sourceId: NativeConversationId
  readonly url: string
}

/** Serialized access to one original page owned by the Desktop shell. */
export interface AxiomTransport {
  /** @param signal Cancels queued acquisition. @returns Idempotent release; hold across a complete page operation. */
  acquire(signal?: AbortSignal): Promise<() => void>
  /** @param url Explicit original conversation URL. @param signal Cancels this operation. @returns Observed source-page state. */
  connect(url: string, signal?: AbortSignal): Promise<AxiomSnapshot>
  /** @param signal Cancels this read. @returns Currently rendered source-page window. */
  snapshot(signal?: AbortSignal): Promise<AxiomSnapshot>
  /** @param request Original user text and observed revision. @param signal Cancels observation, never clicks Stop. @returns Confirmed, refused, or uncertain original-site acknowledgement. */
  send(request: AxiomSendRequest, signal?: AbortSignal): Promise<AxiomSendResult>
  /** @param signal Cancels the reveal request. @returns After the original page is revealed for direct login. */
  showLogin(signal?: AbortSignal): Promise<void>
  /** @param signal Cancels the disconnect request. @returns After closing the owned source page. */
  disconnect(signal?: AbortSignal): Promise<void>
}

/** A bounded visible window, not a complete original transcript. */
export interface AxiomHistory {
  readonly sourceId: NativeConversationId
  readonly url: string
  readonly title: string
  readonly phase: AxiomSnapshot['phase']
  readonly messages: readonly AxiomMessage[]
  /** Always true: the bridge deliberately does not request hidden history. */
  readonly limited: true
}
