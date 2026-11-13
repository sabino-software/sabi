/** The actual shipped composition admits provider-neutral profiles without a platform account menu. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

afterEach(() => vi.unstubAllEnvs())

it.each([undefined, '1'])('loads the shipped account/provider policy with DSH_PROVIDER_NEUTRAL=%s', async (flag) => {
  vi.stubEnv('DSH_PROVIDER_NEUTRAL', flag)
  const sourceRows = ['../cordis.patch.yml', '../../base/cordis.patch.yml'].flatMap(path =>
    loadOverlayPatches('provider-neutral', fileURLToPath(new URL(path, import.meta.url))).flatMap(patch => patch.insert ?? []))
  const gated = ['llm-deepseek', 'llm-deepseek-account', 'ui-settings-account', 'ui-account-notifications']
  const ids = [...gated, 'llm-pi-ai', 'ui-settings-models']
  const rows = sourceRows.filter(row => ids.includes(row.id))
  expect(rows).toHaveLength(ids.length)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  // Real YAML expressions and Loader activation; provider network implementations are outside this policy test.
  const applied = new Map<string | undefined, unknown>()
  ctx.loader.builtins.policy = { apply(scope: Context, config: unknown) { applied.set(scope.fiber.entry?.options.id, config) } }
  await ctx.loader.root.update(rows.map(row => ({ ...row, name: 'cordis:policy' })))
  await ctx.loader.await()
  for (const id of gated) {
    const entry = ctx.loader.resolve(id)
    expect(entry.disabled, id).toBe(flag === '1')
    expect(entry.fiber !== undefined, id).toBe(flag !== '1')
  }
  expect(ctx.loader.resolve('llm-pi-ai').disabled).toBe(false)
  expect(applied.get('ui-settings-models')).toMatchObject({ credentialOnboarding: flag !== '1' })
})
