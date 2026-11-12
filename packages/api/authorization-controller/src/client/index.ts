/** Browser provider sign-in commands and redacted live state. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-authorization-controller/remote'
import { ClientProviderAuthorization } from './service.ts'

export type { ClientProviderAuthorization, ProviderAuthorizationState } from './service.ts'
export type * from '../types.ts'

/** The generated authorization namespace is resolved at plugin activation. */
export const inject = ['remote', 'remote.authorization']

/**
 * Install the browser sign-in owner.
 * @param ctx - browser root context.
 */
export function apply(ctx: Context): void {
  new ClientProviderAuthorization(ctx, ctx.remote.authorization)
}
