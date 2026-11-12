/** Mount the optional source conversation Remote surface from its own plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import remote from '@deepseek-ai/dsh-native-conversations/remote'

/** Native source endpoints are available only with this optional client plugin. */
export const inject = ['remote']

/** Register generated calls without adding experimental runtime input to the core Remote assembly. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await ctx.remote.$mount(remote)
}
