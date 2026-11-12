/** Native source identities and safe connection state shared with clients. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-session-projection/types'
export type * from './axiom-types.ts'
export type * from './codex-activity-types.ts'

/** Original conversation identity, never a filesystem path or an authentication secret. */
export type NativeConversationId = Branded<'NativeConversationId'>
/** A normal Harness Session backed by one original conversation. */
export interface NativeConversationBinding {
  readonly source: 'codex' | 'axiom'
  readonly sourceId: NativeConversationId
  readonly title: string
  readonly model: string | null
  readonly cwd: string | null
}
/** Exact completed original turn represented by a local completed-turn prefix. */
export interface NativeCodexCut {
  readonly sourceId: NativeConversationId
  readonly turnId: string
}
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Exact original cut, recorded only after all its local evidence is committed. */
    'plugin:native-conversations/codex-cut': NativeCodexCut
  }
}
/** Credential-free progress for an explicitly requested managed Codex login. */
export interface NativeCodexLoginStatus {
  readonly phase: 'idle' | 'starting' | 'awaiting-browser' | 'verifying' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed'
  readonly error: string | null
}
/** Owner-visible status; credentials and original transcript data are omitted. */
export interface NativeConversationStatus {
  readonly codex: {
    readonly login: NativeCodexLoginStatus
    readonly connected: boolean
    readonly authenticated: boolean
    readonly selected: boolean
    readonly error: string | null
  }
  readonly axiom: { readonly available: boolean; readonly phase: string }
  readonly syncing: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Original conversation behind this ordinary Session, or null for a Harness-only conversation. */
    nativeConversation: NativeConversationBinding | null
  }
}
