/** Read-only SQLite access; no Codex process, config, or authentication access. */
import { lstatSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { z } from 'zod'
import type { CodexChatId, CodexChatPage, CodexChatSummary, CodexListRequest, CodexMessage, CodexTranscriptPage } from './types.ts'

const PAGE_SIZE = 40
const MESSAGE_SIZE = 131072
const PAGE_BYTES = 524288
const rowSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().max(2000), cwd: z.string().max(4096),
  updated_at: z.number().int().nonnegative().max(8640000000000), archived: z.number().int().min(0).max(1),
})
const requestSchema = z.object({ query: z.string().max(200), archived: z.boolean(), cursor: z.string().max(1000).nullable() }).strict()
const positionSchema = z.object({ ordinal: z.number().int().nonnegative(), id: z.string().min(1).max(200) }).strict()
const itemSchema = z.object({
  item_id: z.string().min(1).max(200), rollout_ordinal: z.number().int().nonnegative(),
  created_at_ms: z.number().int().nonnegative().max(8640000000000000), item_json: z.string(), bytes: z.number().int().nonnegative(),
})

function summary(row: Record<string, SQLOutputValue>): CodexChatSummary {
  const value = rowSchema.parse(row)
  return { id: value.id as CodexChatId, title: value.title, cwd: value.cwd, updatedAt: value.updated_at * 1000, archived: value.archived === 1 }
}

function visibleMessage(value: unknown, id: string, timestamp: number): CodexMessage {
  const item = z.object({ type: z.string() }).passthrough().parse(value)
  if (item.type === 'agentMessage') {
    const message = z.object({ text: z.string() }).parse(item)
    return { id, role: 'assistant', text: message.text, timestamp }
  }
  if (item.type === 'userMessage') {
    const message = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(item)
    return { id, role: 'user', text: message.content.filter(part => part.type === 'text' || part.type === 'inputText').map(part => part.text ?? '').join('\n'), timestamp }
  }
  throw new Error('Unsupported stored message kind')
}

/** Reads only existing SQLite files contained in the configured work home. */
export class CodexLibraryReader {
  /** @param home - Explicit work Codex home; never derived from CODEX_HOME. */
  constructor(private readonly home: string) {
    if (!isAbsolute(home)) throw new Error('Codex source home must be an absolute directory')
  }

  /**
   * Search authored titles with literal case-insensitive matching.
   * @param request - Search, archive selection, and the previous cursor.
   * @returns At most forty catalog rows, newest first.
   */
  list(request: CodexListRequest): CodexChatPage {
    const input = requestSchema.parse(request)
    const offset = input.cursor === null ? 0 : z.coerce.number().int().min(0).max(1000000).parse(input.cursor)
    const database = this.open('state_5.sqlite')
    try {
      const rows = database.prepare(`SELECT substr(id, 1, 201) AS id, substr(COALESCE(NULLIF(name, ''), NULLIF(title, ''), 'Untitled chat'), 1, 2000) AS title,
        substr(cwd, 1, 4096) AS cwd, updated_at, archived FROM threads
        WHERE archived = ? AND instr(lower(COALESCE(name, '') || ' ' || title), lower(?)) > 0
        ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(input.archived ? 1 : 0, input.query, PAGE_SIZE + 1, offset)
      return { sourceHome: this.home, readOnly: true, chats: rows.slice(0, PAGE_SIZE).map(summary), nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null }
    } finally { database.close() }
  }

  /**
   * Read visible text from the paginated history store without loading a thread.
   * @param id - Existing catalog identity; never a filesystem path.
   * @param cursor - Opaque cursor for older messages, or null for the latest page.
   * @returns At most forty messages, capped at 512 KiB including metadata.
   */
  read(id: CodexChatId, cursor: string | null): CodexTranscriptPage {
    z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/).parse(id)
    z.string().max(1000).nullable().parse(cursor)
    const position = cursor === null ? null : positionSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    const catalog = this.open('state_5.sqlite')
    let chat: CodexChatSummary
    try {
      const row = catalog.prepare(`SELECT substr(id, 1, 201) AS id, substr(COALESCE(NULLIF(name, ''), NULLIF(title, ''), 'Untitled chat'), 1, 2000) AS title,
        substr(cwd, 1, 4096) AS cwd, updated_at, archived, history_mode FROM threads WHERE id = ?`).get(id)
      if (row === undefined) throw new Error('Chat is unavailable')
      if (row.history_mode !== 'paginated') throw new Error('Unsupported Codex history format')
      chat = summary(row)
    } finally { catalog.close() }
    const history = this.open('thread_history_1.sqlite')
    try {
      const rows = history.prepare(`SELECT substr(item_id, 1, 201) AS item_id, rollout_ordinal, created_at_ms,
        substr(item_json, 1, ?) AS item_json, length(CAST(item_json AS BLOB)) AS bytes FROM thread_items
        WHERE thread_id = ? AND item_type IN ('userMessage', 'agentMessage')
        AND (? IS NULL OR rollout_ordinal < ? OR (rollout_ordinal = ? AND item_id < ?))
        ORDER BY rollout_ordinal DESC, item_id DESC LIMIT ?`).all(MESSAGE_SIZE, id,
        position?.ordinal ?? null, position?.ordinal ?? null, position?.ordinal ?? null, position?.id ?? '', PAGE_SIZE + 1)
      const messages: CodexMessage[] = []
      let last: z.infer<typeof itemSchema> | undefined
      let limited = false
      let next = rows.length > PAGE_SIZE
      for (const raw of rows.slice(0, PAGE_SIZE)) {
        const row = itemSchema.parse(raw)
        let message: CodexMessage | undefined
        if (row.bytes > MESSAGE_SIZE) {
          limited = true
        } else {
          message = visibleMessage(JSON.parse(row.item_json), row.item_id, row.created_at_ms)
        }
        const candidate = message === undefined || message.text.length === 0 ? messages : [...messages, message]
        const estimate = Buffer.byteLength(JSON.stringify({ chat, messages: candidate, nextCursor: 'x'.repeat(1000), limited: true }))
        if (estimate > PAGE_BYTES) { next = true; break }
        if (message !== undefined && message.text.length > 0) messages.push(message)
        last = row
      }
      const nextCursor = next && last !== undefined
        ? Buffer.from(JSON.stringify({ ordinal: last.rollout_ordinal, id: last.item_id })).toString('base64url') : null
      return { chat, messages: messages.reverse(), nextCursor, limited }
    } finally { history.close() }
  }

  private open(filename: string): DatabaseSync {
    const root = realpathSync(this.home)
    const path = join(root, filename)
    const file = lstatSync(path)
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Codex database is unavailable')
    const actual = realpathSync(path)
    const inside = relative(root, actual)
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Codex database is outside its source home')
    const database = new DatabaseSync(actual, { readOnly: true, enableExtensions: false })
    try {
      database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 500; PRAGMA trusted_schema = OFF')
      return database
    } catch (error: unknown) { database.close(); throw error }
  }
}
