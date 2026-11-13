/** Canonical normal-Session admission shares the discovery owner's presentation policy. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { sessionPresentation } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Refuse a dedicated-view identity before ordinary history or Agent work starts.
 * @param ctx Context owning the Session policy.
 * @param sessionId Requested normal Session.
 * @param signal Optional caller cancellation.
 * @returns After admission; hidden Sessions raise the existing not-found response.
 */
export async function requireVisibleSession(ctx: Context, sessionId: SessionId, signal?: AbortSignal): Promise<void> {
  if ((await sessionPresentation(ctx, sessionId, signal)).visibility === 'hidden') {
    throw new RemoteError('session/not-found', 'This conversation belongs to its dedicated view.', { sessionId })
  }
}
