/** Pure, replayable facts about an operation executed by the original Codex engine. */
import type {} from '@deepseek-ai/dsh-session/types'

/** The id combines the original turn and item ids; completion does not imply success. */
export interface NativeCodexActivity {
  readonly id: string
  readonly type: string
  readonly phase: 'started' | 'completed'
  readonly label: string
  readonly detail: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Native Codex activity, safely ignored by readers without this integration. */
    'plugin:native-conversations/codex-activity': NativeCodexActivity
  }
}
