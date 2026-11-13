// @vitest-environment jsdom
/** Connection actions keep original conversations in the ordinary Session UI. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CodexLibraryPage } from '../src/client/page.tsx'
import type { DesktopAxiomCompanion } from '../src/client/desktop-axiom.ts'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  IconLayersOutlineRegular: () => null,
}))

afterEach(cleanup)
type PageProps = Parameters<typeof CodexLibraryPage>[0]

function mount(options: {
  available?: boolean
  failSync?: boolean
  loading?: boolean
  authenticated?: boolean
  selected?: boolean
  failSelect?: boolean
  invalidLoginUrl?: boolean
  axiomCompanion?: DesktopAxiomCompanion
} = {}) {
  const addresses: string[] = []
  let authenticated = options.authenticated ?? true
  let loginPhase = 'idle'
  let selected = options.selected ?? true
  const useCodex = vi.fn(async () => {
    if (options.failSelect) throw new Error('PRIVATE_PROVIDER_FAILURE')
    selected = true
  })
  const startCodexLogin = vi.fn(async () => {
    loginPhase = 'awaiting-browser'
    return { authUrl: options.invalidLoginUrl ? 'https://evil.test/?token=PRIVATE_TRANSACTION' : 'https://auth.openai.com/oauth/authorize?state=opaque' }
  })
  const cancelCodexLogin = vi.fn(async () => { loginPhase = 'cancelled' })
  const syncCodex = vi.fn(async () => {
    if (options.failSync) throw new Error('Codex app-server connection lost')
    return { imported: 2 }
  })
  const chooseDot = vi.fn(async () => {})
  const showAxiomLogin = vi.fn(async () => {})
  const useResource = ((address: string) => {
    addresses.push(address)
    return { status: options.loading ? 'loading' : 'live', failure: undefined, value: options.loading ? undefined : {
      codex: { connected: true, authenticated, selected, error: null, login: { phase: loginPhase, error: null } }, axiom: { available: options.available ?? true, phase: 'needs-login' }, syncing: false,
    } }
  }) as PageProps['useResource']
  render(<CodexLibraryPage {...{
    ...options.axiomCompanion === undefined ? {} : { axiomCompanion: options.axiomCompanion },
    useDot: selector => selector({ preferences: { enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' },
      busy: false, pending: false, failed: false, preferencesFailed: false }),
    setDotPreferences: async () => {}, useResource, t: makeTranslate(en), syncCodex, chooseDot, showAxiomLogin,
    startCodexLogin, cancelCodexLogin, useCodex,
  } as PageProps} />)
  return { addresses, syncCodex, chooseDot, showAxiomLogin, startCodexLogin, cancelCodexLogin, useCodex,
    completeLogin: () => { authenticated = true; loginPhase = 'succeeded' },
  }
}

describe('Native conversation connections', () => {
  it('selects the already authenticated work account only after an explicit click, without another login', async () => {
    const actions = mount({ selected: false })
    expect(actions.useCodex).not.toHaveBeenCalled()
    expect(screen.queryByText('Using work Codex for new chats.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use work Codex for new chats' }))
    await screen.findByText('Using work Codex for new chats.')
    expect(actions.useCodex).toHaveBeenCalledOnce()
    expect(actions.startCodexLogin).not.toHaveBeenCalled()
    expect(actions.cancelCodexLogin).not.toHaveBeenCalled()
    expect(actions.addresses.at(-1)).toContain('revision=1')
    expect(screen.queryByRole('button', { name: 'Use work Codex for new chats' })).toBeNull()
  })

  it('keeps the explicit selection available after a redacted failure', async () => {
    const actions = mount({ selected: false, failSelect: true })
    fireEvent.click(screen.getByRole('button', { name: 'Use work Codex for new chats' }))
    await screen.findByText('Could not select work Codex. Check its connection and try again.')
    expect(screen.queryByText(/PRIVATE_PROVIDER_FAILURE/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Use work Codex for new chats' }).hasAttribute('disabled')).toBe(false)
    expect(actions.startCodexLogin).not.toHaveBeenCalled()
    expect(actions.cancelCodexLogin).not.toHaveBeenCalled()
  })

  it('shows real connection state and only imports Codex conversations after explicit sync', async () => {
    const actions = mount()
    expect(screen.getByRole('heading', { name: 'Native conversations' })).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.queryByText('Read-only source')).toBeNull()
    expect(actions.syncCodex).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sync Codex conversations' }))
    await screen.findByText('Imported 2 conversations.')
    expect(actions.syncCodex).toHaveBeenCalledTimes(1)
    expect(actions.addresses.at(-1)).toContain('revision=1')
  })

  it('selects Dot without a URL field and opens login only on request', async () => {
    const actions = mount()
    expect(actions.chooseDot).not.toHaveBeenCalled()
    expect(actions.showAxiomLogin).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect Dot' }))
    await waitFor(() => { expect(actions.chooseDot).toHaveBeenCalledExactlyOnceWith() })
    await waitFor(() =>{  expect(screen.getByRole('button', { name: 'Open ChatGPT login' }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Open ChatGPT login' }))
    await waitFor(() =>{  expect(actions.showAxiomLogin).toHaveBeenCalledTimes(1) })
  })

  it('keeps unavailable bridge operations disabled and reports source failures', async () => {
    const actions = mount({ available: false, failSync: true })
    expect(screen.getByText((_text, element) => element?.tagName === 'P' && element.textContent === 'Desktop bridge unavailable · needs-login')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect Dot' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Open ChatGPT login' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sync Codex conversations' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('Codex app-server connection lost')
    expect(actions.chooseDot).not.toHaveBeenCalled()
  })
  it('starts Codex OAuth only on request, exposes a safe browser link, and confirms account completion', async () => {
    const actions = mount({ authenticated: false })
    expect(actions.startCodexLogin).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Continue in browser' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to work Codex' }))
    const link = await screen.findByRole('link', { name: 'Continue in browser' })
    expect(link.getAttribute('href')).toBe('https://auth.openai.com/oauth/authorize?state=opaque')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByText('Codex sign-in confirmed.')).toBeNull()
    actions.completeLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Codex sign-in confirmed.')
    await waitFor(() =>{  expect(screen.queryByRole('link', { name: 'Continue in browser' })).toBeNull() })
    expect(actions.startCodexLogin).toHaveBeenCalledOnce()
    expect(screen.getByText('Codex sign-in does not sign in to the ChatGPT website used by Dot.')).toBeTruthy()
  })

  it('cancels the owned login and removes the browser action', async () => {
    const actions = mount({ authenticated: false })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to work Codex' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Codex sign-in' }))
    await screen.findByText('Codex sign-in cancelled.')
    expect(actions.cancelCodexLogin).toHaveBeenCalledOnce()
    expect(screen.queryByRole('link', { name: 'Continue in browser' })).toBeNull()
  })

  it('does not offer account replacement and rejects an unsafe source login URL', async () => {
    mount()
    expect(screen.queryByRole('button', { name: 'Sign in to work Codex' })).toBeNull()
    cleanup()
    mount({ authenticated: false, invalidLoginUrl: true })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to work Codex' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('Codex sign-in could not be started. Check the work Codex app.')
    expect(screen.queryByRole('link', { name: 'Continue in browser' })).toBeNull()
  })

})

function companion(initial: 'browser' | 'embedded' = 'browser', available = true) {
  let mode = initial
  const metadata = { available, extensionDirectory: '/app/axiom-browser/extension', registrationScript: '/app/axiom-browser/registration.mjs',
    nativeHostScript: '/app/axiom-browser/native-host.sh', nodeExecutable: '/app/runtime/node',
    hostName: 'dev.sabino.skeinlet.axiom', extensionId: 'fixture-extension', permissions: ['activeTab', 'scripting', 'nativeMessaging'] as const }
  const transport = vi.fn(async () => mode)
  const selectTransport = vi.fn(async (next: 'browser' | 'embedded') => { mode = next })
  const browserSetup = vi.fn(async () => metadata)
  return { transport, selectTransport, browserSetup,
    preferences: async () => ({ enabled: true, showInSidebar: false, sidebarStyle: 'sameNewSession' as const }),
    setPreferences: async () => {}, choose: async () => ({ url: null, phase: 'loading' as const }), subscribe: () => () => {} }
}

describe('optional Axiom browser companion controls', () => {
  it('does not expose desktop controls in the ordinary Web panel', () => {
    mount()
    expect(screen.queryByRole('combobox', { name: 'Dot sign-in connection' })).toBeNull()
  })

  it('reads the saved mode without overwriting it and shows manual setup without installing', async () => {
    const bridge = companion()
    mount({ axiomCompanion: bridge })
    const selector = await screen.findByRole('combobox', { name: 'Dot sign-in connection' })
    await waitFor(() => { expect((selector as HTMLSelectElement).value).toBe('browser') })
    expect(bridge.selectTransport).not.toHaveBeenCalled()
    expect(screen.getByText('/app/axiom-browser/extension')).toBeTruthy()
    expect(screen.getByText('/app/axiom-browser/registration.mjs')).toBeTruthy()
    expect(screen.getByText('activeTab, scripting, nativeMessaging')).toBeTruthy()
    expect(screen.getByText(/Cookies and sign-in stay in your browser/)).toBeTruthy()
    expect(screen.getByText(/This panel does not install anything/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull()
  })

  it('finishes an explicit mode switch before allowing the unchanged original URL connection', async () => {
    const bridge = companion('embedded')
    const waiting = Promise.withResolvers<undefined>()
    const original = bridge.selectTransport.getMockImplementation()!
    bridge.selectTransport.mockImplementation(async (mode) => { await waiting.promise; await original(mode) })
    const actions = mount({ axiomCompanion: bridge })
    const selector = screen.getByRole('combobox', { name: 'Dot sign-in connection' })
    await waitFor(() => { expect(selector.hasAttribute('disabled')).toBe(false) })
    fireEvent.change(selector, { target: { value: 'browser' } })
    expect(screen.getByRole('button', { name: 'Connect Dot' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Connect Dot' }))
    expect(actions.chooseDot).not.toHaveBeenCalled()
    waiting.resolve(undefined)
    await waitFor(() => { expect((selector as HTMLSelectElement).value).toBe('browser') })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Dot' }))
    await waitFor(() => { expect(actions.chooseDot).toHaveBeenCalledExactlyOnceWith() })
    expect(bridge.selectTransport).toHaveBeenCalledExactlyOnceWith('browser')
  })

  it('reports a rejected switch without exposing native errors or guessing a new mode', async () => {
    const bridge = companion('embedded')
    bridge.selectTransport.mockRejectedValue(new Error('PRIVATE_NATIVE_PATH'))
    mount({ axiomCompanion: bridge })
    const selector = screen.getByRole('combobox', { name: 'Dot sign-in connection' })
    await waitFor(() => { expect(selector.hasAttribute('disabled')).toBe(false) })
    fireEvent.change(selector, { target: { value: 'browser' } })
    const error = await screen.findByRole('alert')
    expect(error.textContent).toBe(en.axiomTransportError)
    expect(error.textContent).not.toContain('PRIVATE_')
    expect((selector as HTMLSelectElement).value).toBe('embedded')
    expect(screen.getByRole('button', { name: 'Connect Dot' }).hasAttribute('disabled')).toBe(true)
  })

  it('fails visibly when saved-mode metadata cannot be read without choosing a replacement', async () => {
    const bridge = companion()
    bridge.transport.mockRejectedValue(new Error('PRIVATE_METADATA'))
    mount({ axiomCompanion: bridge })
    const error = await screen.findByRole('alert')
    expect(error.textContent).toBe(en.axiomTransportError)
    expect(error.textContent).not.toContain('PRIVATE_')
    expect(bridge.selectTransport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect Dot' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps an unavailable saved browser mode without changing it and permits an explicit app-mode fallback', async () => {
    const bridge = companion('browser', false)
    mount({ axiomCompanion: bridge })
    await screen.findByText(en.axiomBrowserUnavailable)
    expect(bridge.selectTransport).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect Dot' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Dot sign-in connection' }), { target: { value: 'embedded' } })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Connect Dot' }).hasAttribute('disabled')).toBe(false) })
    expect(bridge.selectTransport).toHaveBeenCalledExactlyOnceWith('embedded')
  })
})
