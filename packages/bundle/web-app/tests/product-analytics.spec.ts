/** Shipped Desktop and Web compositions never mount analytics or its exporter. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it, onTestFinished, vi } from 'vitest'

it.each(['desktop', 'web'])('keeps product collection unmounted for %s without manual settings', async (profile) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  const identity = vi.fn().mockResolvedValue({ deviceId: 'device', userId: 'user' })
  ctx.provide('deepseekAccount', { getDeviceIdentity: identity } as never)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  const imported = vi.fn(async (specifier: string) => { throw new Error(`unexpected analytics import: ${specifier}`) })
  ctx.loader.internal = {
    version: 'v2', loadCache: new Map(), import: imported,
    register(): never { throw new Error('unexpected module registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job') },
    resolveSync(): never { throw new Error('unexpected module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  const rows = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'desktop-product-telemetry' || row.id === 'product-analytics')
  expect(rows).toHaveLength(2)
  await ctx.loader.root.update(rows)
  await ctx.loader.await()
  for (const row of rows) {
    const entry = ctx.loader.resolve(row.id!)
    expect(entry.disabled).toBe(true)
    expect(entry.fiber).toBeUndefined()
  }
  expect(rows.find(row => row.id === 'product-analytics')?.config).toMatchObject({ enabled: false })
  expect(ctx.get('productTelemetry')).toBeUndefined()
  expect(ctx.get('productAnalytics')).toBeUndefined()
  expect(imported).not.toHaveBeenCalled()
  expect(identity).not.toHaveBeenCalled()
})
