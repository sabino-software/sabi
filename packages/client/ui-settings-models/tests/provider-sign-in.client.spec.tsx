// @vitest-environment jsdom
/** Provider sign-in actions, redacted stored state, and callback prompt withdrawal. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  AuthorizationAttemptId, AuthorizationPromptId, ProviderAuthorizationState,
} from '@deepseek-ai/dsh-api-authorization-controller/client'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { ProviderSignIn, type ProviderSignInInjected } from '../src/client/ProviderSignIn.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const ATTEMPT = brandString<AuthorizationAttemptId>('attempt')
const PROMPT = brandString<AuthorizationPromptId>('prompt')

function harness() {
  const store = createSnapshotStore<ProviderAuthorizationState>({
    status: 'ready', error: null, pending: false, active: null,
    entries: [{ key: KEY, label: 'ChatGPT (Codex)', methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      configured: false, writable: true, inFlight: false }],
  })
  const commands = {
    load: vi.fn(async () => {}), begin: vi.fn(), answer: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}), logout: vi.fn(async () => {}), t: (key: keyof typeof en) => en[key],
  } satisfies Omit<ProviderSignInInjected, 'hooks'>
  render(<ProviderSignIn {...commands} useAuthorization={bindSnapshotSelector(store)} />)
  return { store, commands }
}

describe('Models provider sign-in', () => {
  it('starts the offered method and snapshots the signed-out production card', () => {
    const { commands } = harness()
    const region = screen.getByRole('region', { name: en.authTitle })
    expect(region.textContent).toMatchInlineSnapshot('"Provider sign-inSign in using a provider account. Saved sign-ins belong to Harness; their validity is checked when used.ChatGPT (Codex)No saved sign-inSign in with ChatGPT"')
    fireEvent.click(within(region).getByRole('button', { name: 'Sign in with ChatGPT' }))
    expect(commands.begin).toHaveBeenCalledWith(KEY, 'oauth')
  })

  it('shows a safe browser link, masks answers, clears the draft, and cancels', async () => {
    const { store, commands } = harness()
    act(() => { store.update(state => {
      state.active = { key: KEY, frame: { attemptId: ATTEMPT, status: 'running',
        notice: { message: 'Continue in your browser', url: 'https://example.com/oauth', code: 'ABCD' },
        prompt: { id: PROMPT, question: { kind: 'secret', message: 'Callback code' } } } }
    }) })
    const link = screen.getByRole('link', { name: en.authOpenBrowser })
    expect(link.getAttribute('href')).toBe('https://example.com/oauth')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('ABCD')).toBeDefined()
    const input = screen.getByLabelText<HTMLInputElement>('Callback code')
    expect(input.type).toBe('password')
    fireEvent.change(input, { target: { value: 'private-code' } })
    fireEvent.click(screen.getByRole('button', { name: en.authContinue }))
    expect(commands.answer).toHaveBeenCalledWith(PROMPT, 'private-code')
    expect(input.value).toBe('')
    expect(document.body.textContent).not.toContain('private-code')
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(commands.cancel).toHaveBeenCalledOnce()
    act(() => { store.update(state => {
      state.active = { key: KEY, frame: { attemptId: ATTEMPT, status: 'cancelled' } }
    }) })
    expect(screen.getByText(en.authCancelled)).toBeDefined()
    expect(screen.queryByLabelText('Callback code')).toBeNull()
  })

  it('refuses unsafe link schemes and displays success, failure, and stored-state changes', () => {
    const { store } = harness()
    act(() => { store.update(state => {
      state.active = { key: KEY, frame: { attemptId: ATTEMPT, status: 'running', notice: { message: 'Open browser', url: 'javascript:alert(1)' } } }
    }) })
    expect(screen.queryByRole('link')).toBeNull()
    act(() => { store.update(state => { state.active = { key: KEY, frame: { attemptId: ATTEMPT, status: 'failed' } } }) })
    expect(screen.getByText(en.authFailed)).toBeDefined()
    act(() => { store.update(state => {
      state.active = { key: KEY, frame: { attemptId: ATTEMPT, status: 'authorized' } }
      state.entries = state.entries.map(entry => ({ ...entry, configured: true }))
    }) })
    expect(screen.getByText(en.authSuccess)).toBeDefined()
    expect(screen.getByText(en.authStored)).toBeDefined()
    expect(screen.getByRole('button', { name: en.authSignOut })).toBeDefined()
  })

  it('confirms sign-out and keeps a visible, localized failure for unsuccessful removal', async () => {
    const { store, commands } = harness()
    act(() => { store.update(state => { state.entries = state.entries.map(entry => ({ ...entry, configured: true })) }) })
    fireEvent.click(screen.getByRole('button', { name: en.authSignOut }))
    const dialog = screen.getByRole('dialog', { name: en.authSignOutTitle })
    expect(commands.logout).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: en.authSignOut })) })
    expect(commands.logout).toHaveBeenCalledWith(KEY)
    act(() => { store.update(state => { state.error = 'logout' }) })
    expect(screen.getByRole('alert').textContent).toBe(en.authLogoutFailed)
    expect(screen.getByText(en.authStored)).toBeDefined()
  })
})
