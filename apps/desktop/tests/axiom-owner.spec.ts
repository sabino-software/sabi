/** Explicit transport changes preserve the current owner while an original send is awaiting acknowledgement. */
import { expect, it, vi } from 'vitest'
import { DesktopAxiomOwner } from '../src/axiom-owner.ts'
import type { AxiomSendResult, AxiomSnapshot } from '../src/axiom-protocol.ts'

it('uses the selected fallback until the user chooses browser mode and refuses switching during a send', async () => {
  const snapshot: AxiomSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/controlled~fixture', title: '', revision: 1,
    phase: 'ready', messages: [], canSend: true, draftPresent: false, siteStatus: null, limited: true }
  const send = Promise.withResolvers<AxiomSendResult>()
  const owner = () => ({ connect: vi.fn(async () => snapshot), choose: vi.fn(async () => snapshot),
    historyBefore: vi.fn(async () => ({ messages: [], hasMore: true, status: 'unavailable' as const })), snapshot: vi.fn(async () => snapshot), send: vi.fn(() => send.promise), showLogin: vi.fn(async () => {}), disconnect: vi.fn() })
  const browser = owner(); const embedded = owner()
  const router = new DesktopAxiomOwner({ browser, embedded }, 'embedded')
  await router.connect(snapshot.url)
  expect(embedded.connect).toHaveBeenCalledOnce()
  expect(browser.connect).not.toHaveBeenCalled()
  router.selectTransport('browser')
  expect(embedded.disconnect).toHaveBeenCalledOnce()
  expect(router.transport()).toBe('browser')
  const pending = router.send({ text: 'Explicit user text' })
  expect(() => { router.selectTransport('embedded') }).toThrow('Wait for the original message acknowledgement')
  send.resolve({ status: 'confirmed', snapshot })
  await pending
  router.selectTransport('embedded')
  expect(browser.disconnect).toHaveBeenCalledOnce()
  expect(() => { router.selectTransport('arbitrary') }).toThrow('Unknown original-page transport')
})


it('does not revoke the working owner when saving its transport preference fails', () => {
  const owner = { connect: vi.fn(), choose: vi.fn(), historyBefore: vi.fn(async () => ({ messages: [], hasMore: true, status: 'unavailable' as const })), snapshot: vi.fn(), send: vi.fn(), showLogin: vi.fn(), disconnect: vi.fn() }
  const save = vi.fn(() => { throw new Error('Preference could not be saved') })
  const router = new DesktopAxiomOwner({ browser: owner, embedded: owner }, 'embedded', save)
  expect(() => { router.selectTransport('browser') }).toThrow('Preference could not be saved')
  expect(router.transport()).toBe('embedded')
  expect(owner.disconnect).not.toHaveBeenCalled()
})

it('saves exact feature choices, revokes both owners on disable and refuses source actions while disabled', async () => {
  const owner = () => ({ connect: vi.fn(), choose: vi.fn(), historyBefore: vi.fn(async () => ({ messages: [], hasMore: true, status: 'unavailable' as const })), snapshot: vi.fn(), send: vi.fn(), showLogin: vi.fn(), disconnect: vi.fn() })
  const browser = owner(); const embedded = owner()
  const save = vi.fn()
  const router = new DesktopAxiomOwner({ browser, embedded }, 'embedded', undefined, undefined, save)
  expect(router.preferences()).toEqual({ enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' })
  expect(() => { router.setPreferences({ enabled: false, showInSidebar: false, extra: true }) }).toThrow()
  router.setPreferences({ enabled: false, showInSidebar: true, sidebarStyle: 'sameNewSession' })
  expect(save).toHaveBeenCalledWith({ enabled: false, showInSidebar: true, sidebarStyle: 'sameNewSession' })
  expect(browser.disconnect).toHaveBeenCalledOnce()
  expect(embedded.disconnect).toHaveBeenCalledOnce()
  expect(() => router.connect('https://chatgpt.com/dots/original')).toThrow('disabled')
  await expect(router.choose(null)).rejects.toThrow('disabled')
  await expect(router.send({})).rejects.toThrow('disabled')
  await expect(router.showLogin()).rejects.toThrow('disabled')
  expect(await router.snapshot()).toMatchObject({ phase: 'disconnected', url: null, messages: [], canSend: false })
  expect(embedded.connect).not.toHaveBeenCalled()
  expect(embedded.choose).not.toHaveBeenCalled()
  expect(embedded.snapshot).not.toHaveBeenCalled()
  router.setPreferences({ enabled: true, showInSidebar: true, sidebarStyle: 'sameNewSession' })
  await router.choose(null)
  expect(embedded.choose).toHaveBeenCalledWith(null)
})

it('keeps existing feature choices on persistence failure and refuses changes or choosing while a send is pending', async () => {
  const pending = Promise.withResolvers<AxiomSendResult>()
  const owner = { connect: vi.fn(), choose: vi.fn(), historyBefore: vi.fn(async () => ({ messages: [], hasMore: true, status: 'unavailable' as const })), snapshot: vi.fn(), send: vi.fn(() => pending.promise),
    showLogin: vi.fn(), disconnect: vi.fn() }
  const save = vi.fn(() => { throw new Error('Save failed') })
  const router = new DesktopAxiomOwner({ browser: owner, embedded: owner }, 'embedded', undefined, undefined, save)
  expect(() => { router.setPreferences({ enabled: false, showInSidebar: false, sidebarStyle: 'sameNewSession' }) }).toThrow('Save failed')
  expect(router.preferences()).toEqual({ enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' })
  expect(owner.disconnect).not.toHaveBeenCalled()
  const sending = router.send({})
  expect(() => { router.setPreferences({ enabled: false, showInSidebar: false, sidebarStyle: 'sameNewSession' }) }).toThrow('Wait for')
  await expect(router.choose(null)).rejects.toThrow('Wait for')
  pending.resolve({ status: 'refused', snapshot: { source: 'chatgpt-web', url: null, title: '', revision: 0,
    phase: 'disconnected', messages: [], canSend: false, draftPresent: false, siteStatus: null, limited: true } })
  await sending
})

it('saves a style-only change without switching the transport or disconnecting the page', () => {
  const owner = { connect: vi.fn(), choose: vi.fn(), historyBefore: vi.fn(async () => ({ messages: [], hasMore: true, status: 'unavailable' as const })), snapshot: vi.fn(), send: vi.fn(), showLogin: vi.fn(), disconnect: vi.fn() }
  const save = vi.fn()
  const router = new DesktopAxiomOwner({ browser: owner, embedded: owner }, 'browser', undefined, undefined, save)
  router.setPreferences({ enabled: true, showInSidebar: false, sidebarStyle: 'outline' })
  expect(save).toHaveBeenCalledExactlyOnceWith({ enabled: true, showInSidebar: false, sidebarStyle: 'outline' })
  expect(router.preferences()).toEqual({ enabled: true, showInSidebar: false, sidebarStyle: 'outline' })
  expect(router.transport()).toBe('browser')
  expect(owner.disconnect).not.toHaveBeenCalled()
  router.setPreferences({ enabled: true, showInSidebar: false, sidebarStyle: 'outline' })
  expect(save).toHaveBeenCalledOnce()
})

it('persists only an actual ready canonical selection and resumes it hidden without relying on legacy Session hints', async () => {
  const state: AxiomSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/actual~source', title: 'Axiom', revision: 1,
    phase: 'ready', messages: [], canSend: true, draftPresent: false, siteStatus: null, limited: true }
  const owner = { connect: vi.fn(async () => state), choose: vi.fn(async () => state), snapshot: vi.fn(async () => state),
    historyBefore: vi.fn(), send: vi.fn(), showLogin: vi.fn(), disconnect: vi.fn() }
  const save = vi.fn()
  const router = new DesktopAxiomOwner({ browser: owner, embedded: owner }, 'embedded', undefined, undefined, undefined, null, save)
  expect(router.selection()).toBeNull()
  router.observe({ ...state, phase: 'loading' })
  expect(save).not.toHaveBeenCalled()
  router.observe(state)
  expect(router.selection()).toEqual({ url: state.url, title: 'Axiom' })
  expect(save).toHaveBeenCalledOnce()
  await router.resume()
  expect(owner.connect).toHaveBeenCalledWith(state.url)
  await router.choose('https://chatgpt.com/dots/old-mirror')
  expect(owner.choose).toHaveBeenCalledWith(state.url)
  expect(owner.showLogin).not.toHaveBeenCalled()
  router.setPreferences({ enabled: false, showInSidebar: false, sidebarStyle: 'sameNewSession' })
  owner.connect.mockClear()
  expect(await router.resume()).toBeNull()
  expect(owner.connect).not.toHaveBeenCalled()
})
