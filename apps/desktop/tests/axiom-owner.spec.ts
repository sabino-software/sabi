/** Explicit transport changes preserve the current owner while an original send is awaiting acknowledgement. */
import { expect, it, vi } from 'vitest'
import { DesktopAxiomOwner } from '../src/axiom-owner.ts'
import type { AxiomSendResult, AxiomSnapshot } from '../src/axiom-protocol.ts'

it('uses the selected fallback until the user chooses browser mode and refuses switching during a send', async () => {
  const snapshot: AxiomSnapshot = { source: 'chatgpt-web', url: 'https://chatgpt.com/dots/controlled~fixture', title: '', revision: 1,
    phase: 'ready', messages: [], canSend: true, draftPresent: false, siteStatus: null, limited: true }
  const send = Promise.withResolvers<AxiomSendResult>()
  const owner = () => ({ connect: vi.fn(async () => snapshot), snapshot: vi.fn(async () => snapshot), send: vi.fn(() => send.promise),
    showLogin: vi.fn(async () => {}), disconnect: vi.fn() })
  const browser = owner(); const embedded = owner()
  const router = new DesktopAxiomOwner({ browser, embedded }, 'embedded')
  await router.connect(snapshot.url)
  expect(embedded.connect).toHaveBeenCalledOnce()
  expect(browser.connect).not.toHaveBeenCalled()
  router.selectTransport('browser')
  expect(embedded.disconnect).toHaveBeenCalledOnce()
  expect(router.transport()).toBe('browser')
  const pending = router.send({ text: 'Explicit user text' })
  expect(() => router.selectTransport('embedded')).toThrow('Wait for the original message acknowledgement')
  send.resolve({ status: 'confirmed', snapshot })
  await pending
  router.selectTransport('embedded')
  expect(browser.disconnect).toHaveBeenCalledOnce()
  expect(() => router.selectTransport('arbitrary')).toThrow('Unknown original-page transport')
})


it('does not revoke the working owner when saving its transport preference fails', () => {
  const owner = { connect: vi.fn(), snapshot: vi.fn(), send: vi.fn(), showLogin: vi.fn(), disconnect: vi.fn() }
  const save = vi.fn(() => { throw new Error('Preference could not be saved') })
  const router = new DesktopAxiomOwner({ browser: owner, embedded: owner }, 'embedded', save)
  expect(() => router.selectTransport('browser')).toThrow('Preference could not be saved')
  expect(router.transport()).toBe('embedded')
  expect(owner.disconnect).not.toHaveBeenCalled()
})
