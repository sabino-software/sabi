/** Browser-safe operations for the user-selected original ChatGPT Dot page. */

/** Text from one message body rendered by the original website. */
export interface AxiomMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp: string | null
  readonly truncated: boolean
}

/** Observed page state, never an agent response produced by Harness. */
export interface AxiomSnapshot {
  readonly source: 'chatgpt-web'
  readonly url: string | null
  readonly title: string
  readonly revision: number
  readonly phase: 'disconnected' | 'loading' | 'login-required' | 'ready' | 'unavailable'
  readonly messages: readonly AxiomMessage[]
  /** The original page has an editable composer and Send control; final admission stays with that control. */
  readonly canSend: boolean
  readonly draftPresent: boolean
  /** Observed website status or a static navigation warning; authentication URLs and credentials are excluded. */
  readonly siteStatus: string | null
  readonly limited: boolean
  readonly errorCode?: 'page-unavailable' | 'unsupported-page'
}

/** One explicit user submission, never retried after an ambiguous acknowledgement. */
export interface AxiomSendRequest {
  readonly requestId: string
  readonly revision: number
  readonly text: string
}

/** Confirmation means the original website rendered a new matching user message. */
export interface AxiomSendResult {
  readonly status: 'confirmed' | 'unknown' | 'refused'
  readonly snapshot: AxiomSnapshot
  readonly messageId?: string
}

/** Supported original-page owners; the browser choice requires explicit extension pairing. */
export type AxiomTransportMode = 'browser' | 'embedded'

/** Reviewable installed artifacts; returning these paths never installs or registers the extension. */
export interface AxiomBrowserSetup {
  readonly protocolVersion: 1
  readonly available: boolean
  readonly extensionDirectory: string
  readonly registrationScript: string
  readonly permissions: readonly ['activeTab', 'scripting', 'nativeMessaging']
  readonly nativeHostScript: string
  readonly nodeExecutable: string
  readonly hostName: string
  readonly extensionId: string
}

/** Desktop original-page adapter; website authentication remains with the selected browser owner. */
export interface DesktopAxiomBridge {
  /** @returns Current original-page transport. */
  transport(): Promise<AxiomTransportMode>
  /** @param mode Explicit original-page transport. @returns After revoking the previous connection. */
  selectTransport(mode: AxiomTransportMode): Promise<void>
  /** @returns Packaged setup artifact paths without modifying a browser profile. */
  browserSetup(): Promise<AxiomBrowserSetup>
  /** @param url Directly selected original Dot URL. @returns Bounded source-page state after navigation. */
  connect(url: string): Promise<AxiomSnapshot>
  /** @returns Current rendered source-page window, without fetching hidden history. */
  snapshot(): Promise<AxiomSnapshot>
  /** @param request Exact user-authored text and observed revision. @returns Original-page acknowledgement or uncertainty. */
  send(request: AxiomSendRequest): Promise<AxiomSendResult>
  /** @returns After revealing the original website for direct login or unsupported interactions. */
  showLogin(): Promise<void>
  /** @returns After revoking observations; regular-browser tabs and website login remain browser-owned. */
  disconnect(): Promise<void>
  /** @param listener Receives changed source-page projections. @returns The subscription disposer. */
  subscribe(listener: (state: AxiomSnapshot) => void): () => void
}
