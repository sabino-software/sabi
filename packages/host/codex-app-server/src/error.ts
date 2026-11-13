/** Structured, sanitized native daemon failures. */
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { CodexAppServerErrorCode } from './types.ts'

const MESSAGES: Record<CodexAppServerErrorCode, string> = {
  CODEX_UNAVAILABLE: 'The work Codex daemon is unavailable. Start it and reconnect.',
  CODEX_DISCONNECTED: 'The work Codex connection closed. Reconnect and inspect the thread before retrying.',
  CODEX_PROTOCOL: 'The work Codex connection returned an invalid protocol message. Reconnect to refresh its state.',
  CODEX_LIMIT: 'The work Codex connection reached its transport limit. Reload a smaller history page or try again.',
  CODEX_CANCELLED: 'The Codex request was cancelled. Inspect the thread before repeating a submitted action.',
  CODEX_TIMEOUT: 'The Codex request timed out. Inspect the thread before repeating a submitted action.',
  CODEX_RPC_REJECTED: 'Codex rejected the request. Refresh the thread and review the current operation.',
  CODEX_DISPOSED: 'The Codex connection has been disposed.',
  CODEX_METHOD_UNSUPPORTED: 'This Codex operation is not supported by the native transport.',
  CODEX_HANDLER_EXISTS: 'A Codex server-request handler is already registered for this method.',
  CODEX_WRONG_HOME: 'The Codex daemon belongs to another source home. Check the configured work socket.',
}

/** A failed submitted mutation is never implicitly retried, because it may already have committed. */
export class CodexAppServerError extends HarnessError {
  /** Whether a submitted mutation may have committed despite this failure. */
  readonly outcomeUnknown: boolean
  /** Original numeric RPC rejection code, or null for non-RPC failures. */
  readonly rpcCode: number | null
  /** Sanitized upstream RPC error classification, or null when unavailable. */
  readonly rpcErrorType: string | null

  /**
   * @param code - Stable failure class.
   * @param facts - Optional outcome and sanitized upstream classification.
   */
  constructor(code: CodexAppServerErrorCode, facts: {
    readonly outcomeUnknown?: boolean
    readonly rpcCode?: number | null
    readonly rpcErrorType?: string | null
  } = {}) {
    super(MESSAGES[code], code)
    this.outcomeUnknown = facts.outcomeUnknown ?? false
    this.rpcCode = facts.rpcCode ?? null
    this.rpcErrorType = facts.rpcErrorType ?? null
  }
}
