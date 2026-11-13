/** Website events only navigate while an explicit user selection is armed. */
import { expect, it, vi } from 'vitest'
import { createDotController } from '../src/client/dot-controller.ts'
import type { DesktopAxiomCompanion, DotSelection } from '../src/client/desktop-axiom.ts'

const ready: DotSelection = { phase: 'ready', url: 'https://chatgpt.com/dots/original~opaque' }
function fixture(chooseState: DotSelection = { phase: 'login-required', url: null }) {
  let listener = (_state: DotSelection): void => {}
  const off = vi.fn()
  const choose = vi.fn(async (_hint: string | null) => chooseState)
  const setPreferences = vi.fn(async () => {})
  const companion: DesktopAxiomCompanion = {
    preferences: async () => ({ enabled: true, showInSidebar: false }), setPreferences, choose,
    subscribe: (callback) => { listener = callback; return off }, transport: async () => 'browser',
    selectTransport: vi.fn(), browserSetup: vi.fn(),
  }
  const connect = vi.fn(async (_url: string, _isCurrent: () => boolean) => {})
  const preferredUrl = vi.fn(async () => ready.url)
  const controller = createDotController(companion, { connect, preferredUrl })
  return { controller, connect, companion, choose, setPreferences, off, publish: (state: DotSelection) => { listener(state) } }
}

it('waits for sign-in after explicit URL-free selection and opens once after a ready reload', async () => {
  const f = fixture()
  f.publish(ready)
  expect(f.connect).not.toHaveBeenCalled()
  await f.controller.choose()
  expect(f.choose).toHaveBeenCalledExactlyOnceWith(ready.url)
  expect(f.controller.store.getSnapshot().pending).toBe(true)
  f.publish(ready); f.publish(ready)
  await vi.waitFor(() => { expect(f.connect).toHaveBeenCalledOnce() })
  expect(f.connect.mock.calls[0]?.[0]).toBe(ready.url)
  expect(f.companion.selectTransport).not.toHaveBeenCalled()
  f.controller.dispose()
  expect(f.off).toHaveBeenCalledOnce()
})

it('accepts immediate ready selection and disarms on feature disable or disposal', async () => {
  const immediate = fixture(ready)
  await immediate.controller.choose()
  expect(immediate.connect).toHaveBeenCalledOnce()
  immediate.controller.dispose()
  const f = fixture()
  await f.controller.choose()
  await f.controller.setPreferences({ enabled: false, showInSidebar: true })
  f.publish(ready)
  await f.controller.choose()
  expect(f.connect).not.toHaveBeenCalled()
  expect(f.setPreferences).toHaveBeenCalledWith({ enabled: false, showInSidebar: true })
  f.controller.dispose()
  f.publish(ready)
  expect(f.connect).not.toHaveBeenCalled()
})

it('uses the chooser result after transient old-page teardown instead of cancelling the new selection', async () => {
  const f = fixture()
  f.choose.mockImplementation(async () => {
    f.publish({ phase: 'disconnected', url: null })
    f.publish(ready)
    return { phase: 'login-required', url: null }
  })
  await f.controller.choose()
  expect(f.controller.store.getSnapshot()).toMatchObject({ pending: true, failed: false })
  expect(f.connect).not.toHaveBeenCalled()
  f.publish(ready)
  await vi.waitFor(() => { expect(f.connect).toHaveBeenCalledOnce() })
  f.controller.dispose()
})

it('rejects unrelated pages and disarms failed selection without repeated navigation', async () => {
  const f = fixture({ ...ready, url: 'https://chatgpt.com/c/unrelated' })
  await f.controller.choose()
  expect(f.controller.store.getSnapshot().failed).toBe(true)
  f.publish(ready)
  expect(f.connect).not.toHaveBeenCalled()
  f.controller.dispose()
})

it('suppresses navigation if disabled while the connection is completing', async () => {
  const f = fixture(ready)
  const waiting = Promise.withResolvers<undefined>()
  f.connect.mockImplementation(async (_url, isCurrent) => { await waiting.promise; expect(isCurrent()).toBe(false) })
  const selecting = f.controller.choose()
  await vi.waitFor(() => { expect(f.connect).toHaveBeenCalledOnce() })
  await f.controller.setPreferences({ enabled: false, showInSidebar: false })
  waiting.resolve(undefined)
  await selecting
  f.controller.dispose()
})
