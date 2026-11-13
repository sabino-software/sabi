/** The continuous Dot surface never creates a Harness Session or synthetic message. */
import { expect, it, vi } from 'vitest'
import { createDotController } from '../src/client/dot-controller.ts'
import type { DesktopAxiomCompanion, DotMessage, DotSnapshot, DotSendResult, DotPreferences, DotHistoryPage } from '../src/client/desktop-axiom.ts'

const message = (id: string, role: 'user' | 'assistant' = 'assistant', text = id): DotMessage =>
  ({ id, role, text, timestamp: null, truncated: false })
const snapshot: DotSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/original~opaque', title: 'Axiom',
  phase: 'ready', revision: 1, messages: [message('u1', 'user'), message('a1')], canSend: true,
  draftPresent: false, siteStatus: null, limited: true }
function fixture(enabled = true) {
  let listener = (_snapshot: DotSnapshot): void => {}
  const off = vi.fn()
  const companion: DesktopAxiomCompanion = {
    preferences: vi.fn(async (): Promise<DotPreferences> => ({ enabled, showInSidebar: true, sidebarStyle: 'sameNewSession' })),
    setPreferences: vi.fn(async () => {}), selection: vi.fn(async () => ({ url: snapshot.url!, title: 'Axiom' })),
    snapshot: vi.fn(async () => snapshot), choose: vi.fn(async () => snapshot),
    subscribe: (callback) => { listener = callback; return off },
    historyBefore: vi.fn(async (): Promise<DotHistoryPage> => ({ messages: [message('old')], hasMore: false, status: 'ready' })),
    send: vi.fn(async (): Promise<DotSendResult> => ({ status: 'confirmed', snapshot: { ...snapshot, revision: 2,
      messages: [...snapshot.messages, message('u2', 'user', 'exact text')] }, messageId: 'u2' })),
    showLogin: vi.fn(async () => {}), transport: vi.fn(async () => 'embedded' as const),
    selectTransport: vi.fn(async () => {}), browserSetup: vi.fn(),
  }
  const controller = createDotController(companion)
  return { controller, companion, off, publish: (value: DotSnapshot) => { listener(value) } }
}

it('reads the actual selected title without opening a page, then opens the connected original directly', async () => {
  const f = fixture()
  await vi.waitFor(() => { expect(f.controller.store.getSnapshot().selection?.title).toBe('Axiom') })
  expect(f.companion.choose).not.toHaveBeenCalled()
  expect(f.companion.snapshot).toHaveBeenCalledOnce()
  expect(f.controller.store.getSnapshot().messages.map(value => value.id)).toEqual(['u1', 'a1'])
  await f.controller.open()
  expect(f.controller.store.getSnapshot().messages.map(value => value.id)).toEqual(['u1', 'a1'])
  expect(f.companion.choose).not.toHaveBeenCalled()
  f.controller.dispose()
  expect(f.off).toHaveBeenCalledOnce()
})
it('chooses only after an explicit open when disconnected and preserves source chronology while loading older pages', async () => {
  const f = fixture()
  vi.mocked(f.companion.snapshot).mockResolvedValue({ ...snapshot, phase: 'disconnected', url: null, messages: [] })
  await f.controller.open()
  expect(f.companion.choose).toHaveBeenCalledWith(snapshot.url)
  await f.controller.loadOlder()
  expect(f.companion.historyBefore).toHaveBeenCalledWith('u1')
  f.publish({ ...snapshot, revision: 2, messages: [message('a1', 'assistant', 'streamed'), message('u2', 'user')] })
  expect(f.controller.store.getSnapshot().messages.map(value => value.id)).toEqual(['old', 'u1', 'a1', 'u2'])
  expect(f.controller.store.getSnapshot().messages[2]?.text).toBe('streamed')
  expect(f.controller.store.getSnapshot().hasMore).toBe(false)
  f.controller.dispose()
})
it('sends exact authored text at the source revision once and admits only observed original messages', async () => {
  const f = fixture()
  await f.controller.open()
  f.controller.setDraft('exact text')
  await f.controller.send()
  expect(f.companion.send).toHaveBeenCalledOnce()
  const sent = vi.mocked(f.companion.send).mock.calls[0]?.[0]
  expect(sent?.text).toBe('exact text')
  expect(sent?.revision).toBe(1)
  expect(sent?.requestId).toMatch(/^[a-f0-9-]{36}$/)
  expect(f.controller.store.getSnapshot().draft).toBe('')
  expect(f.controller.store.getSnapshot().messages.at(-1)?.id).toBe('u2')
  expect(f.controller.store.getSnapshot().sendOutcome).toBe('confirmed')
  f.controller.dispose()
})
it('retains an unknown submission without retrying or appending an invented user/assistant message', async () => {
  const f = fixture()
  vi.mocked(f.companion.send).mockRejectedValue(new Error('acknowledgement unavailable'))
  await f.controller.open()
  f.controller.setDraft('uncertain send')
  await f.controller.send()
  f.publish({ ...snapshot, revision: 2 })
  expect(f.companion.send).toHaveBeenCalledOnce()
  expect(f.controller.store.getSnapshot().sendOutcome).toBe('unknown')
  expect(f.controller.store.getSnapshot().draft).toBe('uncertain send')
  expect(f.controller.store.getSnapshot().messages).toEqual(snapshot.messages)
  f.controller.dispose()
})
it('reports unsupported history without fake exhaustion and permits an explicit retry', async () => {
  const f = fixture()
  vi.mocked(f.companion.historyBefore).mockResolvedValueOnce({ messages: [], status: 'unavailable', hasMore: true })
  await f.controller.open()
  await f.controller.loadOlder()
  expect(f.controller.store.getSnapshot()).toMatchObject({ history: 'unavailable', hasMore: true })
  await f.controller.loadOlder()
  expect(f.companion.historyBefore).toHaveBeenCalledTimes(2)
  expect(f.controller.store.getSnapshot().hasMore).toBe(false)
  f.controller.dispose()
})
it('preserves loaded history across explicit page close and prevents sending while disabled', async () => {
  const f = fixture()
  await f.controller.open()
  await f.controller.loadOlder()
  f.publish({ ...snapshot, phase: 'disconnected', url: null, messages: [], revision: 2, canSend: false })
  await f.controller.open()
  expect(f.controller.store.getSnapshot().messages[0]?.id).toBe('old')
  await f.controller.setPreferences({ enabled: false, showInSidebar: true, sidebarStyle: 'outline' })
  f.controller.setDraft('disabled')
  await f.controller.send()
  expect(f.companion.send).not.toHaveBeenCalled()
  f.controller.dispose()
})

it('does not reconfigure or invalidate an outstanding original send when the top view is reopened', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<DotSendResult>()
  vi.mocked(f.companion.send).mockImplementation(() => pending.promise)
  await f.controller.open()
  f.controller.setDraft('pending send')
  const sending = f.controller.send()
  await f.controller.open()
  await f.controller.configure()
  expect(f.companion.snapshot).toHaveBeenCalledTimes(2)
  expect(f.companion.choose).not.toHaveBeenCalled()
  expect(f.controller.store.getSnapshot().sending).toBe(true)
  pending.resolve({ status: 'unknown', snapshot })
  await sending
  expect(f.controller.store.getSnapshot()).toMatchObject({ sending: false, sendOutcome: 'unknown', draft: 'pending send' })
  expect(f.companion.send).toHaveBeenCalledOnce()
  f.controller.dispose()
})
it('keeps a newer ready source event emitted while an older snapshot request is pending', async () => {
  const f = fixture()
  await vi.waitFor(() => { expect(f.controller.store.getSnapshot().snapshot?.phase).toBe('ready') })
  const pending = Promise.withResolvers<DotSnapshot>()
  vi.mocked(f.companion.snapshot).mockImplementation(() => pending.promise)
  const opening = f.controller.open()
  await vi.waitFor(() => { expect(f.companion.snapshot).toHaveBeenCalledTimes(2) })
  f.publish({ ...snapshot, revision: 3, messages: [...snapshot.messages, message('autonomous')] })
  pending.resolve({ ...snapshot, revision: 2 })
  await opening
  expect(f.controller.store.getSnapshot().snapshot?.revision).toBe(3)
  expect(f.controller.store.getSnapshot().messages.at(-1)?.id).toBe('autonomous')
  f.controller.dispose()
})
it('does not let an old rejected history page overwrite a newly selected source state', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<DotHistoryPage>()
  vi.mocked(f.companion.historyBefore).mockImplementation(() => pending.promise)
  await f.controller.open()
  const older = f.controller.loadOlder()
  f.publish({ ...snapshot, url: 'https://chatgpt.com/dots/another', title: 'Another', revision: 1, messages: [message('new')] })
  pending.reject(new Error('old source page failed'))
  await older
  expect(f.controller.store.getSnapshot()).toMatchObject({ selection: { title: 'Another' }, history: 'idle', hasMore: true })
  f.controller.dispose()
})

it('hydrates a source already ready before subscription without choosing, sending, or opening anything', async () => {
  const f = fixture()
  await vi.waitFor(() => { expect(f.controller.store.getSnapshot().snapshot).toEqual(snapshot) })
  expect(f.controller.store.getSnapshot().messages).toEqual(snapshot.messages)
  expect(f.companion.snapshot).toHaveBeenCalledOnce()
  expect(f.companion.choose).not.toHaveBeenCalled()
  expect(f.companion.showLogin).not.toHaveBeenCalled()
  expect(f.companion.send).not.toHaveBeenCalled()
  f.controller.dispose()
})
it('preserves a newer subscription while the initial read-only snapshot is pending', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<DotSnapshot>()
  vi.mocked(f.companion.snapshot).mockImplementation(() => pending.promise)
  await vi.waitFor(() => { expect(f.companion.snapshot).toHaveBeenCalledOnce() })
  const newer = { ...snapshot, revision: 5, messages: [...snapshot.messages, message('warm-update')] }
  f.publish(newer)
  pending.resolve({ ...snapshot, revision: 2 })
  await vi.waitFor(() => { expect(f.controller.store.getSnapshot().snapshot).toEqual(newer) })
  expect(f.companion.choose).not.toHaveBeenCalled()
  f.controller.dispose()
})
it('does not resurrect a source closed during the initial snapshot read or sample a disabled integration', async () => {
  const f = fixture()
  const pending = Promise.withResolvers<DotSnapshot>()
  vi.mocked(f.companion.snapshot).mockImplementation(() => pending.promise)
  await vi.waitFor(() => { expect(f.companion.snapshot).toHaveBeenCalledOnce() })
  f.publish({ ...snapshot, phase: 'disconnected', url: null, messages: [], canSend: false, revision: 0 })
  pending.resolve(snapshot)
  await Promise.resolve()
  await Promise.resolve()
  expect(f.controller.store.getSnapshot().snapshot?.phase).toBe('disconnected')
  f.controller.dispose()
  const disabled = fixture(false)
  await vi.waitFor(() => { expect(disabled.controller.store.getSnapshot().preferences?.enabled).toBe(false) })
  expect(disabled.companion.snapshot).not.toHaveBeenCalled()
  disabled.controller.dispose()
})
it('reports an initial source-read failure separately from preferences and permits explicit top-button retry', async () => {
  const f = fixture()
  vi.mocked(f.companion.snapshot).mockRejectedValueOnce(new Error('source temporarily unavailable'))
  await vi.waitFor(() => { expect(f.controller.store.getSnapshot().failed).toBe(true) })
  expect(f.controller.store.getSnapshot()).toMatchObject({ preferencesFailed: false, preferences: { enabled: true } })
  expect(f.companion.choose).not.toHaveBeenCalled()
  await f.controller.open()
  expect(f.controller.store.getSnapshot()).toMatchObject({ failed: false, snapshot: { phase: 'ready' } })
  expect(f.companion.snapshot).toHaveBeenCalledTimes(2)
  f.controller.dispose()
})
