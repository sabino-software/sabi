// @vitest-environment jsdom
/** Source identity decorates ordinary Sessions without creating a second conversation surface. */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativeConversationBinding, NativeConversationId } from '@deepseek-ai/dsh-experimental-native-conversations/types'
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
  const props = { t, useProjection: () => ({ ...binding, source: 'axiom' as const }) } as HeaderProps
  const view = render(<NativeSourceHeader {...props} />)
  expect(screen.getByText('Axiom')).toBeTruthy()
  expect(screen.queryByText(binding.model!)).toBeNull()
  view.rerender(<NativeSourceHeader {...{ ...props, useProjection: () => null } as HeaderProps} />)
  expect(view.container.textContent).toBe('')
})
