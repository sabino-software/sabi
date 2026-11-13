/** Validate the trusted main-frame website API without importing Electron or exposing credentials. */
import { afterEach, expect, it, vi } from 'vitest'
import { desktopAxiomCompanion, type DotSnapshot } from '../src/client/desktop-axiom.ts'

const setup = { protocolVersion: 1, available: true, extensionDirectory: '/app/extension', registrationScript: '/app/registration.mjs',
  nativeHostScript: '/app/native-host.sh', nodeExecutable: '/app/node', hostName: 'fixture-host', extensionId: 'fixture-extension',
  permissions: ['activeTab', 'scripting', 'nativeMessaging'] }
const snapshot: DotSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/original', title: 'Axiom', revision: 1,
  phase: 'ready', messages: [{ id: 'u1', role: 'user', text: 'observed', timestamp: null, truncated: false }],
  canSend: true, draftPresent: false, siteStatus: null, limited: true }
const bridge = () => ({
  preferences: async () => ({ enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' }),
  setPreferences: vi.fn(async () => {}), choose: vi.fn(async () => snapshot), snapshot: async () => snapshot,
  send: vi.fn(async () => ({ status: 'confirmed', snapshot, messageId: 'u1' })), showLogin: vi.fn(async () => {}),
  selection: async () => ({ url: snapshot.url, title: 'Axiom' }), transport: async () => 'embedded',
  selectTransport: vi.fn(async () => {}), browserSetup: async () => setup,
  historyBefore: vi.fn(async () => ({ messages: [], hasMore: false, status: 'ready' })), subscribe: () => () => {},
})
afterEach(() => { vi.unstubAllGlobals() })
it('stays absent for Web, incompatible versions, and bridges without direct source operations', () => {
  vi.stubGlobal('dshDesktop', undefined)
  expect(desktopAxiomCompanion()).toBeUndefined()
  vi.stubGlobal('dshDesktop', { protocolVersion: 2, axiom: bridge() })
  expect(desktopAxiomCompanion()).toBeUndefined()
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: { transport: async () => 'browser' } })
  expect(desktopAxiomCompanion()).toBeUndefined()
})
it('preserves full observed messages, selection, revision, original send result and history semantics', async () => {
  const native = bridge()
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: native })
  const client = desktopAxiomCompanion()!
  expect(await client.selection()).toEqual({ url: snapshot.url, title: 'Axiom' })
  expect(await client.snapshot()).toEqual(snapshot)
  expect(await client.choose(null)).toEqual(snapshot)
  const request = { requestId: 'once', revision: 1, text: 'exact input' }
  expect(await client.send(request)).toEqual({ status: 'confirmed', snapshot, messageId: 'u1' })
  expect(native.send).toHaveBeenCalledExactlyOnceWith(request)
  expect(await client.historyBefore('u1')).toEqual({ messages: [], hasMore: false, status: 'ready' })
  expect(native.historyBefore).toHaveBeenCalledExactlyOnceWith('u1')
  expect(native.selectTransport).not.toHaveBeenCalled()
  expect((await client.preferences()).sidebarStyle).toBe('sameNewSession')
})
it('reports older-history capability absence without claiming exhaustion', async () => {
  const { historyBefore: _unsupported, selection: _olderSelection, ...native } = bridge()
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: native })
  expect(await desktopAxiomCompanion()!.historyBefore('u1')).toEqual({ messages: [], status: 'unavailable', hasMore: true })
  expect(await desktopAxiomCompanion()!.selection()).toBeNull()
})
it('rejects malformed source states and unknown sidebar style enums at the preload boundary', async () => {
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: { ...bridge(),
    snapshot: async () => ({ ...snapshot, messages: [{ id: 'bad', role: 'system', text: 'invented' }] }),
    preferences: async () => ({ enabled: true, showInSidebar: true, sidebarStyle: 'invented' }),
  } })
  await expect(desktopAxiomCompanion()!.snapshot()).rejects.toThrow()
  await expect(desktopAxiomCompanion()!.preferences()).rejects.toThrow()
})


it('preserves bounded source row order independently of missing message bodies', async () => {
  const sourceOrder = ['u1', 'missing-body', 'a1']
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: { ...bridge(),
    snapshot: async () => ({ ...snapshot, sourceOrder }),
    historyBefore: async () => ({ messages: [], sourceOrder, hasMore: true, status: 'ready' }),
  } })
  const client = desktopAxiomCompanion()!
  expect((await client.snapshot()).sourceOrder).toEqual(sourceOrder)
  expect((await client.historyBefore('u1')).sourceOrder).toEqual(sourceOrder)
})

it.each([
  { name: 'too many IDs', sourceOrder: Array.from({ length: 101 }, (_, index) => `id-${index}`) },
  { name: 'an oversized ID', sourceOrder: ['x'.repeat(513)] },
  { name: 'an empty ID', sourceOrder: [''] },
])(
  'rejects source order metadata with $name', async ({ sourceOrder }) => {
    vi.stubGlobal('dshDesktop', { protocolVersion: 1, axiom: { ...bridge(),
      snapshot: async () => ({ ...snapshot, sourceOrder }),
      historyBefore: async () => ({ messages: [], sourceOrder, hasMore: true, status: 'ready' }),
    } })
    await expect(desktopAxiomCompanion()!.snapshot()).rejects.toThrow()
    await expect(desktopAxiomCompanion()!.historyBefore('u1')).rejects.toThrow()
  },
)
