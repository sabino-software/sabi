// @vitest-environment jsdom
/** Search, archive selection, and transcript navigation keep source browsing read-only. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CodexLibraryPage } from '../src/client/page.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Input: ({ icon: _icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }) => <input {...props} />,
  IconLayersOutlineRegular: () => null,
  IconSearchOutlineRegular: () => null,
  MarkdownText: ({ text }: { text: string }) => <div data-markdown>{text}</div>,
}))

afterEach(cleanup)

type PageProps = Parameters<typeof CodexLibraryPage>[0]

function mount(status: 'live' | 'failed' | 'loading' = 'live') {
  const addresses: string[] = []
  const useResource = ((address: string) => {
    addresses.push(address)
    if (address === '') return { status: 'none', value: undefined, failure: undefined }
    const transcript = address.startsWith('dsh-resource://codex-transcript')
    return { status, failure: undefined, value: status !== 'live' ? undefined : transcript ? {
      chat: { id: 'chat-one', title: 'Saved coding work' },
      messages: [{ id: 'm1', role: 'user', text: 'Explain this function', timestamp: 1700000000000 }, { id: 'm2', role: 'assistant', text: '**Saved answer**', timestamp: 1700000000001 }],
      nextCursor: 'older-page', limited: false,
    } : {
      sourceHome: '/fixture/work/.codex', readOnly: true,
      chats: [{ id: 'chat-one', title: 'Saved coding work', cwd: '/work/project', updatedAt: 1700000000000, archived: false }], nextCursor: 'next-page',
    } }
  }) as PageProps['useResource']
  render(<CodexLibraryPage {...{ useResource, t: (key: keyof typeof en) => en[key] } as PageProps} />)
  return addresses
}

describe('Codex chat browser', () => {
  it('labels the source, opens saved text lazily, and offers no composer', () => {
    const addresses = mount()
    expect(screen.getByText('Read-only source')).toBeTruthy()
    expect(screen.getByText('/fixture/work/.codex')).toBeTruthy()
    expect(addresses.some(address => address.startsWith('dsh-resource://codex-transcript'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Saved coding work/ }))
    expect(screen.getByText('Explain this function')).toBeTruthy()
    expect(screen.getByText('**Saved answer**')).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText('Assistant')).toBeTruthy()
    expect(document.querySelector('textarea')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Older messages' }))
    expect(addresses.at(-1)).toContain('cursor=older-page')
    fireEvent.click(screen.getByRole('button', { name: 'Latest messages' }))
    expect(addresses.at(-1)).not.toContain('cursor=')
  })

  it('submits title search and archive selection, with independent bounded paging', () => {
    const addresses = mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search titles' }), { target: { value: 'function' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(addresses.at(-2)).toContain('query=function')
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    expect(addresses.at(-2)).toContain('archived=true')
    fireEvent.click(screen.getByRole('button', { name: 'Next chats' }))
    expect(addresses.at(-2)).toContain('cursor=next-page')
    fireEvent.click(screen.getByRole('button', { name: 'First page' }))
    expect(addresses.at(-2)).not.toContain('cursor=')
  })

  it('keeps load failures visible and offers a refresh', () => {
    mount('failed')
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })
})
