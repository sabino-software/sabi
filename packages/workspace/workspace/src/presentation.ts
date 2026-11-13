/** Process-local Session presentation; default compositions retain ordinary discovery and opening. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPresentation } from './types.ts'

/**
 * Resolve extension-owned visibility and client routing without changing persisted state.
 * @param ctx Context owning the presentation listeners.
 * @param sessionId Session identity; this operation does not establish existence.
 * @param signal Optional metadata-read cancellation.
 * @returns The first owner's policy, or ordinary visible presentation when none claims the identity.
 */
export async function sessionPresentation(ctx: Context, sessionId: SessionId, signal?: AbortSignal): Promise<SessionPresentation> {
  signal?.throwIfAborted()
  const value = await ctx.serial('workspace/session-presentation', sessionId, signal)
  signal?.throwIfAborted()
  return value ?? { visibility: 'visible' }
}
