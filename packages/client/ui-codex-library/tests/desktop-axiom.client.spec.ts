/** Optional desktop operations are detected structurally and their manual-setup metadata is validated. */
import { afterEach, expect, it, vi } from 'vitest'
import { desktopAxiomCompanion } from '../src/client/desktop-axiom.ts'

const setup = { protocolVersion: 1, available: true, extensionDirectory: '/app/extension', registrationScript: '/app/registration.mjs',
  nativeHostScript: '/app/native-host.sh', nodeExecutable: '/app/node', hostName: 'fixture-host', extensionId: 'fixture-extension',
  permissions: ['activeTab', 'scripting', 'nativeMessaging'] }

afterEach(() => { vi.unstubAllGlobals() })

it('stays absent for ordinary Web, incompatible protocol versions, and partial older bridges', () => {
  vi.stubGlobal('dshDesktop', undefined)
  expect(desktopAxiomCompanion()).toBeUndefined()
  vi.stubGlobal('dshDesktop', { protocolVersion: 2, axiom: {} })
  expect(desktopAxiomCompanion()).toBeUndefined()
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: { transport: async () => 'browser' } })
  expect(desktopAxiomCompanion()).toBeUndefined()
})

it('reads saved mode and returns only declared setup metadata without selecting or installing', async () => {
  const selectTransport = vi.fn(async () => {})
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: {
    transport: async () => 'browser', selectTransport, browserSetup: async () => ({ ...setup, privateExtra: 'not-exported' }),
  } })
  const bridge = desktopAxiomCompanion()!
  expect(await bridge.transport()).toBe('browser')
  const metadata = await bridge.browserSetup()
  expect(metadata.extensionDirectory).toBe('/app/extension')
  expect(metadata).not.toHaveProperty('privateExtra')
  expect(selectTransport).not.toHaveBeenCalled()
  await bridge.selectTransport('embedded')
  expect(selectTransport).toHaveBeenCalledExactlyOnceWith('embedded')
})

it('rejects incompatible modes and unexpected extension permissions at the preload boundary', async () => {
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: {
    transport: async () => 'invented-mode', selectTransport: async () => {},
    browserSetup: async () => ({ ...setup, permissions: [...setup.permissions, 'cookies'] }),
  } })
  const bridge = desktopAxiomCompanion()!
  await expect(bridge.transport()).rejects.toThrow()
  await expect(bridge.browserSetup()).rejects.toThrow()
})
