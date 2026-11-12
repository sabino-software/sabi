/** Host owner of read-only work Codex chat browsing. */
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CodexLibraryReader } from './reader.ts'
import type { CodexChatId, CodexChatPage, CodexListRequest, CodexTranscriptPage } from './types.ts'

/** Work source selection, independent of CODEX_HOME and the app's storage home. */
export interface Config {
  /** Absolute work Codex home containing the source catalog and history databases. */
  readonly sourceHome: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Existing work chats, with no source mutation methods. */
    codexLibrary: CodexLibraryController
  }
}

/** Provides only catalog and transcript reads; never starts a Codex process. */
export default class CodexLibraryController extends TypertRemoteService {
  /** Work catalog location; never uses the personal CODEX_HOME override. */
  static Config: z<Partial<Config>, Config> = z.object({ sourceHome: z.string().default(join(homedir(), '.codex')) })
  private readonly reader: CodexLibraryReader

  /**
   * @param ctx - Host context with Typert.
   * @param config - Work source selection.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'codexLibrary')
    this.reader = new CodexLibraryReader(config.sourceHome)
  }

  /**
   * List existing source chats with literal title search.
   * @param request - Query, archive selection, and optional paging cursor.
   * @returns A bounded page labeled with its source home.
   */
  @Remote
  list(request: CodexListRequest): CodexChatPage {
    try { return this.reader.list(request) }
    catch (_unavailableSource: unknown) { throw new RemoteError('gateway/internal', 'Codex chats could not be read. Check the configured work Codex home and try again.', {}) }
  }

  /**
   * Read a page of visible authored text, without resuming its source chat.
   * @param id - Existing catalog identity.
   * @param cursor - Cursor for older messages, or null for the latest page.
   * @returns Text and timestamps without tool output, reasoning, auth, or configuration.
   */
  @Remote
  read(id: CodexChatId, cursor: string | null): CodexTranscriptPage {
    try { return this.reader.read(id, cursor) }
    catch (_unavailableSource: unknown) { throw new RemoteError('gateway/internal', 'This Codex transcript could not be read. Its local history may be unavailable or use an unsupported format.', {}) }
  }
}
