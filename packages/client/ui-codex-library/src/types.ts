/** Read-only views of existing work Codex chats. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity from the source Codex catalog. */
export type CodexChatId = Branded<'CodexChatId'>

/** A catalog row without source configuration or credentials. */
export interface CodexChatSummary {
  readonly id: CodexChatId
  readonly title: string
  readonly cwd: string
  readonly updatedAt: number
  readonly archived: boolean
}

/** Catalog filter with a bounded opaque paging cursor. */
export interface CodexListRequest {
  readonly query: string
  readonly archived: boolean
  readonly cursor: string | null
}

/** One page of existing chats, explicitly identified as source data. */
export interface CodexChatPage {
  readonly sourceHome: string
  readonly readOnly: true
  readonly chats: readonly CodexChatSummary[]
  readonly nextCursor: string | null
}

/** Authored visible text, without tool output, reasoning, or instructions. */
export interface CodexMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp: number | null
}

/** A recent-first page rendered in chronological order. */
export interface CodexTranscriptPage {
  readonly chat: CodexChatSummary
  readonly messages: readonly CodexMessage[]
  readonly nextCursor: string | null
  readonly limited: boolean
}
