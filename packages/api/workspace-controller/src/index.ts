/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { sessionPresentation } from '@deepseek-ai/dsh-workspace'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed, workspaceView } from './feed.ts'
import { defaultWorkspaceDirectory, validateDocumentsDirectory } from './default-directory.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceBaseline,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceId,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspacePinSessionRequest,
  WorkspacePinValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceUnpinSessionRequest,
  WorkspaceValue, WorkspaceView,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

/** First-use directory policy for the Host account. */
export interface Config {
  /** Override the system Documents directory with a fully qualified path. */
  documentsDirectory?: string
  /** Maximum duration of the operating system's Documents lookup. */
  documentsLookupTimeoutMs?: number
}

/** Directory policy after schema defaults have been applied. */
type ResolvedConfig = Config & { documentsLookupTimeoutMs: number }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['remoteAccess', 'typert', 'workspaceRegistry']

  static Config: z<Config, ResolvedConfig> = z.object({
    documentsDirectory: z.string(),
    documentsLookupTimeoutMs: z.natural().min(1).default(10_000),
  })

  private readonly config: ResolvedConfig
  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed

  /**
   * @param ctx - Host context containing the Workspace registry.
   * @param config - first-use directory policy.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    ctx.typert.resources.register('workspace', { field: 'workspaceId' })
    this.config = WorkspaceController.Config(config)
    if (this.config.documentsDirectory !== undefined) validateDocumentsDirectory(this.config.documentsDirectory)
    this.commands = new WorkspaceCommands(ctx)
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('create')
  async create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    const result = await this.commands.create(request)
    return { ...result, workspace: await this.visibleWorkspace(result.workspace) }
  }

  /**
   * Initialize or reuse the default Workspace during first-use startup. The
   * directory name is fixed, so the Host never renames or relocates an
   * existing default; its initial title is that same name, which browser
   * consumers label in the reader's language.
   * @param signal - caller lifetime; cancels native directory lookup.
   * @returns the durable Workspace, or undefined when first-use initialization is ineligible; creates no Session or message.
   */
  @Remote('initializeDefault')
  async initializeDefault(signal: AbortSignal): Promise<WorkspaceValue | undefined> {
    const workspace = await this.ctx.workspaceRegistry.initializeDefault(async () => {
      const timeout = AbortSignal.timeout(this.config.documentsLookupTimeoutMs)
      return await defaultWorkspaceDirectory(
        this.config.documentsDirectory, AbortSignal.any([signal, timeout]),
      )
    })
    return workspace === undefined ? undefined : { workspace: await this.visibleWorkspace(workspaceView(workspace)) }
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @Remote('rename')
  async rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const result = await this.commands.rename(request)
    return { ...result, workspace: await this.visibleWorkspace(result.workspace) }
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @Remote('insertSessionBefore')
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    await this.requireVisible(request.sessionId)
    const result = await this.commands.insertSessionBefore(request)
    return { ...result, workspace: await this.visibleWorkspace(result.workspace) }
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @Remote('archiveSession')
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    await this.requireVisible(request.sessionId)
    const result = await this.commands.archiveSession(request)
    return { ...result, archivedSessionIds: await this.visibleSessions(result.archivedSessionIds) }
  }

  /**
   * Restore one archived Session to Workspace grouping surfaces.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  @Remote('unarchiveSession')
  async unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    await this.requireVisible(request.sessionId)
    const result = await this.commands.unarchiveSession(request)
    return { ...result, archivedSessionIds: await this.visibleSessions(result.archivedSessionIds) }
  }

  /**
   * Surface one known unarchived Session ahead of unpinned Sessions.
   * @param request - Session identity to pin.
   * @returns the complete resulting pin set, most recently pinned first.
   */
  @Remote('pinSession')
  async pinSession(request: WorkspacePinSessionRequest): Promise<WorkspacePinValue> {
    await this.requireVisible(request.sessionId)
    const result = await this.commands.pinSession(request)
    return { ...result, pinnedSessionIds: await this.visibleSessions(result.pinnedSessionIds) }
  }

  /**
   * Remove one Session's pin without changing its saved Session order.
   * @param request - Session identity to unpin.
   * @returns the complete resulting pin set, most recently pinned first.
   */
  @Remote('unpinSession')
  async unpinSession(request: WorkspaceUnpinSessionRequest): Promise<WorkspacePinValue> {
    await this.requireVisible(request.sessionId)
    const result = await this.commands.unpinSession(request)
    return { ...result, pinnedSessionIds: await this.visibleSessions(result.pinnedSessionIds) }
  }

  private async visibleSessions(ids: readonly SessionId[], signal?: AbortSignal): Promise<SessionId[]> {
    const visible: SessionId[] = []
    for (const id of ids) {
      if (this.ctx.remoteAccess.allows({ kind: 'session', id })
        && (await sessionPresentation(this.ctx, id, signal)).visibility !== 'hidden') visible.push(id)
    }
    return visible
  }
  private async visibleWorkspace(workspace: WorkspaceView): Promise<WorkspaceView> {
    return { ...workspace, sessionIds: await this.visibleSessions(workspace.sessionIds) }
  }
  private async requireVisible(id: SessionId): Promise<void> {
    if ((await sessionPresentation(this.ctx, id)).visibility === 'hidden') {
      throw new RemoteError('gateway/bad-request', 'This conversation belongs to its dedicated view.', {})
    }
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments. A
   * non-owner receives only the Workspaces and Sessions `allows()` admits.
   * When a delivered Workspace is no longer admitted at its next change or
   * the next order change, the stream sends a `replace` frame with the
   * complete filtered state instead of a `remove`, because a Client never
   * resurrects a removed Workspace; a `remove` frame reports a deletion and
   * reaches only a Client that received that Workspace.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    const access = this.ctx.remoteAccess
    const visible = (workspaceId: WorkspaceId): boolean => access.allows({ kind: 'workspace', id: workspaceId })
    const sessions = (ids: readonly SessionId[]): Promise<SessionId[]> => this.visibleSessions(ids, signal)
    /** Workspaces this generation has delivered and not yet removed. */
    const delivered = new Set<WorkspaceId>()
    /** The admitted part of `value`; it becomes the delivered set. */
    const filtered = async (value: WorkspaceBaseline): Promise<WorkspaceBaseline> => {
      const items = value.items.filter(item => visible(item.workspaceId))
      delivered.clear()
      for (const item of items) delivered.add(item.workspaceId)
      return {
        items: await Promise.all(items.map(async item => ({ ...item, sessionIds: await sessions(item.sessionIds) }))),
        archivedSessionIds: await sessions(value.archivedSessionIds),
        pinnedSessionIds: await sessions(value.pinnedSessionIds),
      }
    }
    for await (const frame of this.feed.follow(signal)) {
      switch (frame.type) {
        case 'baseline':
          yield { type: 'baseline', value: await filtered(frame.value) }
          break
        case 'upsert': {
          const workspaceId = frame.workspace.workspaceId
          if (visible(workspaceId)) {
            delivered.add(workspaceId)
            yield { type: 'upsert', workspace: { ...frame.workspace, sessionIds: await sessions(frame.workspace.sessionIds) } }
          } else if (delivered.has(workspaceId)) {
            yield { type: 'replace', value: await filtered(this.feed.baseline()) }
          }
          break
        }
        case 'remove':
          if (delivered.delete(frame.workspaceId)) yield frame
          break
        case 'order':
          if (frame.workspaceIds.some(workspaceId => delivered.has(workspaceId) && !visible(workspaceId))) {
            yield { type: 'replace', value: await filtered(this.feed.baseline()) }
          } else {
            yield { type: 'order', workspaceIds: frame.workspaceIds.filter(visible) }
          }
          break
        case 'archived':
          yield { type: 'archived', archivedSessionIds: await sessions(frame.archivedSessionIds) }
          break
        case 'pinned':
          yield { type: 'pinned', pinnedSessionIds: await sessions(frame.pinnedSessionIds) }
          break
        /* v8 ignore next -- closed follow-frame union. */
        default:
          assertNever(frame)
      }
    }
  }
}

/* v8 ignore next 3 -- closed-union backstop. */
function assertNever(value: never): never {
  throw new Error(`unreachable Workspace follow frame: ${JSON.stringify(value)}`)
}

export default WorkspaceController
