// @vitest-environment jsdom
/** Connection actions keep original conversations in the ordinary Session UI. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CodexLibraryPage } from '../src/client/page.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  IconLayersOutlineRegular: () => null,
}))

afterEach(cleanup)
type PageProps = Parameters<typeof CodexLibraryPage>[0]

function mount(options: { available?: boolean; failSync?: boolean; loading?: boolean } = {}) {
  const addresses: string[] = []
  const syncCodex = vi.fn(async () => {
    if (options.failSync) throw new Error('Codex app-server connection lost')
    return { imported: 2 }
  })
  const connectAxiom = vi.fn(async (_url: string) => {})
  const showAxiomLogin = vi.fn(async () => {})
  const useResource = ((address: string) => {
    addresses.push(address)
    return { status: options.loading ? 'loading' : 'live', failure: undefined, value: options.loading ? undefined : {
      codex: { connected: true, authenticated: true, selected: true, error: null }, axiom: { available: options.available ?? true, phase: 'needs-login' }, syncing: false,
    } }
  }) as PageProps['useResource']
  render(<CodexLibraryPage {...{ useResource, t: makeTranslate(en), syncCodex, connectAxiom, showAxiomLogin } as PageProps} />)
  return { addresses, syncCodex, connectAxiom, showAxiomLogin }
}

describe('Native conversation connections', () => {
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

  it('connects the exact entered original Axiom URL and opens login only on request', async () => {
    const actions = mount()
    expect(actions.connectAxiom).not.toHaveBeenCalled()
    expect(actions.showAxiomLogin).not.toHaveBeenCalled()
    const url = 'https://chatgpt.com/dots/original~opaque'
    fireEvent.change(screen.getByRole('textbox', { name: 'Existing ChatGPT Dot URL' }), { target: { value: url } })
    fireEvent.submit(screen.getByRole('textbox', { name: 'Existing ChatGPT Dot URL' }).closest('form')!)
    await waitFor(() => expect(actions.connectAxiom).toHaveBeenCalledWith(url))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open ChatGPT login' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Open ChatGPT login' }))
    await waitFor(() => expect(actions.showAxiomLogin).toHaveBeenCalledTimes(1))
  })

  it('keeps unavailable bridge operations disabled and reports source failures', async () => {
    const actions = mount({ available: false, failSync: true })
    expect(screen.getByText((_text, element) => element?.tagName === 'P' && element.textContent === 'Desktop bridge unavailable · needs-login')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect Axiom' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Open ChatGPT login' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sync Codex conversations' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('Codex app-server connection lost')
    expect(actions.connectAxiom).not.toHaveBeenCalled()
  })
})
