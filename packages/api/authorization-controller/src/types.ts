/** Browser-safe provider sign-in projections; credential payloads never cross this API. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AuthorizationEntry, AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'

/** Random capability identifying one live sign-in attempt. */
export type AuthorizationAttemptId = Branded<'AuthorizationAttemptId'>
/** Random capability identifying one unanswered question. */
export type AuthorizationPromptId = Branded<'AuthorizationPromptId'>

/** One registered provider's sign-in methods and redacted stored credential state. */
export interface AuthorizationFlowView extends AuthorizationEntry {
  /** A credential record is stored; its validity is verified by the provider on use. */
  configured: boolean
  /** The active store can delete or replace this record. */
  writable: boolean
}

/** Prompt variants without their Host-only cancellation signal. */
export type AuthorizationQuestion = {
  [Kind in AuthorizationPrompt['kind']]: Omit<Extract<AuthorizationPrompt, { kind: Kind }>, 'signal'>
}[AuthorizationPrompt['kind']]

/** One complete sign-in projection, replacing the previous frame. */
export interface AuthorizationFrame {
  /** Attempt capability, needed to answer or cancel from its initiating surface. */
  attemptId: AuthorizationAttemptId
  /** A terminal failure contains no provider exception text or token material. */
  status: 'running' | 'authorized' | 'cancelled' | 'failed'
  /** Latest provider instruction, if one exists. */
  notice?: AuthorizationNotice
  /** Present only while this question is waiting for an answer. */
  prompt?: {
    id: AuthorizationPromptId
    question: AuthorizationQuestion
  }
}
