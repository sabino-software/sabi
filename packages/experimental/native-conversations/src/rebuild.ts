/** Explicit local mirror replacement. Old history is archived evidence, never replayed or rewritten. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Session, SessionId, SESSION_FORMAT_VERSION, appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SourceSessionAssignment } from './source-index.ts'
import { BINDING_RECORD, bindingSchema } from './projection.ts'
import { sourceSessionId } from './history.ts'

/** Only navigation/index state is compensated; process interruption is not an atomic transaction. */
export async function rebuildCodexMirror(
  ctx: Context,
  sources: Pick<KvTable<SessionId, SourceSessionAssignment>, 'get' | 'put'>,
  oldId: SessionId,
  blocked: Set<SessionId>,
): Promise<{ sessionId: SessionId; archivedSessionId: SessionId }> {
  const refuse = (): never => { throw new RemoteError('gateway/bad-request', 'This inactive, unpinned top-level Codex mirror could not be verified for explicit recovery.', {}) }
  if (ctx.agents.get(oldId) || ctx.workspaceRegistry.archivedSessionIds.includes(oldId)
    || ctx.workspaceRegistry.pinnedSessionIds.includes(oldId)) refuse()
  const original = await ctx.sessionPersistence.stat(oldId)
  if (!original) return refuse()
  const header = original.header
  if (header.isSeeded || header.parentSession !== undefined || header.origin !== undefined
    || header.delegationDepth !== undefined && header.delegationDepth !== 0) refuse()
  const stored = await ctx.sessionPersistence.list()
  if (stored.some(item => item.header.parentSession === oldId)) refuse()
  const cached = ctx.sessionProjectionCache.cachedSnapshot(header)
  const parsed = bindingSchema.safeParse(cached?.values.nativeConversation)
  if (!parsed.success || parsed.data.source !== 'codex') return refuse()
  const binding = parsed.data
  const sourceKey = sourceSessionId('codex', binding.sourceId)
  const prior = sources.get(sourceKey)
  if (prior?.sessionId !== oldId || prior.createdAt !== header.createdAt) return refuse()
  const workspace = ctx.workspaceRegistry.list().find(item => item.path === header.cwd && item.sessionIds.includes(oldId))
  if (!workspace) return refuse()
  const inactive = async (): Promise<void> => {
    if (ctx.agents.get(oldId) || ctx.workspaceRegistry.archivedSessionIds.includes(oldId)
      || ctx.workspaceRegistry.pinnedSessionIds.includes(oldId)) refuse()
    const activity = await ctx.waterfall('workspace/session-activity', { sessionId: oldId }, () => Promise.resolve([]))
    if (activity.length > 0 || ctx.agents.get(oldId) || ctx.workspaceRegistry.archivedSessionIds.includes(oldId)
      || ctx.workspaceRegistry.pinnedSessionIds.includes(oldId)) refuse()
  }
  await inactive()
  const id = SessionId(`session-${randomUUID()}`)
  blocked.add(id)
  let created = false
  let attached = false
  let retainBlock = false
  try {
    const freshHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: header.createdAt, isSeeded: false, cwd: workspace.path } as const
    const fresh = Session.create(id, undefined, freshHeader)
    const events = [appendPluginRecord(fresh, BINDING_RECORD, binding, { returnEvent: true }),
      fresh.append('session/title', { title: binding.title, messageSeqs: [], source: { kind: 'user' } })]
    const model = binding.model ?? (await ctx.llm.listModels('codex-app-server'))[0]?.id
    if (!model) return refuse()
    events.push(fresh.append('model/selection', { provider: 'codex-app-server', model }))
    const handle = await ctx.sessionPersistence.create(freshHeader)
    created = true
    try { await handle.append(events); await handle.flush() } finally { await handle.close() }
    // This is a NEW id: ordinary strict read/restore is mandatory, never a damaged-log salvage path.
    const read = await ctx.sessionPersistence.open(id, 'read')
    let verified: Session
    try {
      const restored = await read.read()
      verified = Session.fromRestore(id, restored.events, read.header, read.inheritedEventCount, restored.eventState)
    } finally { await read.close() }
    await ctx.workspaceRegistry.archiveSession(id)
    await ctx.sessionProjectionCache.write(verified)
    const unchanged = await ctx.sessionPersistence.stat(oldId)
    if (unchanged?.revision !== original.revision || sources.get(sourceKey)?.sessionId !== oldId
      || sources.get(sourceKey)?.createdAt !== prior.createdAt) refuse()
    await inactive()
    attached = true
    await workspace.attachSession(id)
    await sources.put(sourceKey, { sessionId: id, createdAt: freshHeader.createdAt })
    await ctx.workspaceRegistry.unarchiveSession(id)
    // Archive the original last. Rollback must never unarchive another owner's concurrent action.
    try { await ctx.workspaceRegistry.archiveSession(oldId) }
    catch (error) { if (!ctx.workspaceRegistry.archivedSessionIds.includes(oldId)) throw error }
    return { sessionId: id, archivedSessionId: oldId }
  } catch (_failure: unknown) {
    let rollbackFailed = false
    const compensate = async (operation: () => Promise<unknown>): Promise<void> => {
      try { await operation() } catch (_rollback: unknown) { rollbackFailed = true }
    }
    const current = sources.get(sourceKey)
    if (current?.sessionId === id) await compensate(() => sources.put(sourceKey, prior))
    else if (current?.sessionId !== oldId || current.createdAt !== prior.createdAt) rollbackFailed = true
    // Creation can fail after publishing its header. Keep that uncertain candidate archived too.
    if (!created) await compensate(async () => { created = await ctx.sessionPersistence.stat(id) !== undefined })
    if (created) await compensate(() => ctx.workspaceRegistry.archiveSession(id))
    if (attached) await compensate(() => workspace.detachSession(id))
    if (rollbackFailed) {
      retainBlock = true
      throw new RemoteError('gateway/internal', `Codex mirror recovery needs owner inspection. Local candidate ${id} was retained; verify its archive and source assignment before retrying.`, {})
    }
    throw new RemoteError('gateway/internal', 'Codex mirror recovery failed. The original assignment was restored; any new local candidate was retained archived.', {})
  } finally {
    if (!retainBlock) blocked.delete(id)
  }
}
