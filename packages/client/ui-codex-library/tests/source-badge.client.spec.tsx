// @vitest-environment jsdom
/** Source identity decorates ordinary Sessions without creating a second conversation surface. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeConversationBinding, NativeConversationId } from '@deepseek-ai/dsh-native-conversations/types'
import { NativeSourceHeader, NativeSourceRow } from '../src/client/source-badge.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const sessionId = 'native-session' as SessionId
const t = makeTranslate(en)
const binding: NativeConversationBinding = {
  source: 'codex', sourceId: 'original-thread' as NativeConversationId,
  title: 'Existing coding task', model: 'gpt-source-model', cwd: '/fixture/project',
}

it('labels a native row using its existing Session summary', () => {
  const list = createSnapshotStore<SessionListState>({
    ids: [sessionId], phase: 'ready', projectionsBySession: {},
    byId: { [sessionId]: {
      id: sessionId, displayTitle: binding.title, running: false, retainedBy: {}, blank: false,
      updatedAt: 1, projectionValues: { nativeConversation: binding },
    } },
  })
  type RowProps = Parameters<typeof NativeSourceRow>[0]
  const props = { sessionId, useSessions: bindSnapshotSelector(list), t } as RowProps
  render(<NativeSourceRow {...props} />)
  expect(screen.getByLabelText('Codex').title).toBe('Continues the original Codex thread.')
  expect(screen.queryByRole('button')).toBeNull()
})

it('labels Axiom without inventing a model and leaves ordinary Harness headers alone', () => {
  type HeaderProps = Parameters<typeof NativeSourceHeader>[0]
  const props = { t, showOriginal: vi.fn(async () => {}), useProjection: () => ({ ...binding, source: 'axiom' as const }) } as HeaderProps
  const view = render(<NativeSourceHeader {...props} />)
  expect(screen.getByText('Axiom')).toBeTruthy()
  expect(screen.queryByText(binding.model!)).toBeNull()
  view.rerender(<NativeSourceHeader {...{ ...props, useProjection: () => null } as HeaderProps} />)
  expect(view.container.textContent).toBe('')
})


it('shows only the source badge for Codex and never invokes the original-page action', () => {
  type HeaderProps = Parameters<typeof NativeSourceHeader>[0]
  const showOriginal = vi.fn(async () => {})
  render(<NativeSourceHeader {...{ t, showOriginal, useProjection: () => binding } as HeaderProps} />)
  expect(screen.getByText('Codex').title).toBe('Continues the original Codex thread.')
  expect(screen.queryByRole('button')).toBeNull()
  expect(showOriginal).not.toHaveBeenCalled()
})

it('opens the original ChatGPT page through the Host callback and disables repeated input while pending', async () => {
  type HeaderProps = Parameters<typeof NativeSourceHeader>[0]
  const pending = Promise.withResolvers<undefined>()
  const showOriginal = vi.fn(() => pending.promise)
  render(<NativeSourceHeader {...{ t, showOriginal, useProjection: () => ({ ...binding, source: 'axiom' }) } as HeaderProps} />)
  const button = screen.getByRole('button', { name: 'Open ChatGPT' }) as HTMLButtonElement
  fireEvent.click(button)
  expect(showOriginal).toHaveBeenCalledOnce()
  expect(button.disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Opening ChatGPT…' })).toBe(button)
  fireEvent.click(button)
  expect(showOriginal).toHaveBeenCalledOnce()
  await act(async () => { pending.resolve(undefined); await pending.promise })
  expect(screen.getByRole('button', { name: 'Open ChatGPT' })).toBe(button)
  expect(button.disabled).toBe(false)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('shows localized failure copy without provider details and permits an explicit retry', async () => {
  type HeaderProps = Parameters<typeof NativeSourceHeader>[0]
  const showOriginal = vi.fn().mockRejectedValueOnce(new Error('private provider diagnostics')).mockResolvedValueOnce(undefined)
  render(<NativeSourceHeader {...{ t, showOriginal, useProjection: () => ({ ...binding, source: 'axiom' }) } as HeaderProps} />)
  const button = screen.getByRole('button', { name: 'Open ChatGPT' })
  fireEvent.click(button)
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.openOriginalError) })
  expect(screen.queryByText('private provider diagnostics')).toBeNull()
  fireEvent.click(button)
  await waitFor(() => { expect(showOriginal).toHaveBeenCalledTimes(2); expect(screen.queryByRole('alert')).toBeNull() })
})
