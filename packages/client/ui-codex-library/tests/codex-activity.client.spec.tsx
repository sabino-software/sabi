// @vitest-environment jsdom
/** Original engine operations fold into one stable card through the standard conversation seam. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { ConversationNodeAssembler, type ConversationNodeDefinition, type ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { NativeCodexActivity } from '@deepseek-ai/dsh-native-conversations/types'
import { CodexActivityCard, codexActivityDefinition, type CodexActivityCardProps } from '../src/client/codex-activity.tsx'
import { en } from '../src/client/codex-activity-locales.ts'

afterEach(cleanup)

class Definitions {
  entries(): readonly ConversationNodeDefinition[] { return [codexActivityDefinition] }
  fallbackEntry(): undefined { return undefined }
}
class Views {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}
const started: NativeCodexActivity = { id: 'turn-one:item-one', type: 'commandExecution', phase: 'started', label: 'Run command', detail: 'Source command detail' }
function record(seq: number, data: unknown, ignorable?: true): SessionLiveEventEntry {
  // The released event type table excludes ignorable records; this is the same durable adapter boundary.
  const event = { type: 'plugin:native-conversations/codex-activity', seq: SessionSeq(seq), time: 1000 + seq,
    ...ignorable === undefined ? {} : { ignorable }, data }
  return { type: 'event', event: event as SessionEvent }
}
function entry(seq: number, activity: NativeCodexActivity): SessionLiveEventEntry {
  return record(seq, { ...activity }, true)
}
function snapshot(entries: readonly SessionLiveEventEntry[], hasMore = false): ChatSnapshot {
  const assembler = new ConversationNodeAssembler(new Definitions(), new Views())
  assembler.replaceWindow(entries, hasMore)
  assembler.activateTarget('chat')
  const value = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (value === undefined) throw new Error('Chat view was not activated')
  return value
}

describe('native Codex activity conversation cards', () => {
  it('updates the same id at its first sequence with a session location, including completion-only paged history', () => {
    const completed = { ...started, phase: 'completed' as const, detail: 'Source completed detail' }
    const value = snapshot([entry(2, started), entry(7, completed)])
    expect(value.order).toHaveLength(1)
    expect(value.nodes.get(value.order[0]!)).toMatchObject({ kind: 'native-codex-activity', anchorSeq: 2,
      location: { kind: 'session' }, visibility: 'visible', data: completed })
    const paged = snapshot([entry(7, completed)], true)
    expect(paged.nodes.get(paged.order[0]!)).toMatchObject({ anchorSeq: 7, data: completed })
    const expanded = snapshot([entry(2, started), entry(7, completed)], true)
    expect(expanded.nodes.get(expanded.order[0]!)).toMatchObject({ anchorSeq: 2, data: completed })
  })

  it('keeps separate source operations and turn-scoped ids visible without merging them', () => {
    const types = ['commandExecution', 'fileChange', 'webSearch', 'mcpToolCall', 'collabAgentToolCall']
    const value = snapshot(types.map((type, index) => entry(index + 1, { ...started, id: `turn-${index}:same-item`, type })))
    expect(value.order).toHaveLength(types.length)
    expect(value.order.map(key => value.nodes.get(key)?.data)).toMatchObject(types.map(type => ({ type })))
  })

  it('ignores malformed durable records instead of inventing an activity', () => {
    expect(codexActivityDefinition.match(record(1, { id: 'broken' }, true).event)).toBeNull()
    expect(codexActivityDefinition.match(record(1, { ...started }).event)).toBeNull()
  })

  it('shows original source and finished state with expandable source detail', () => {
    const props = { node: { id: started.id, data: { ...started, phase: 'completed' } }, t: makeTranslate(en, commonEn) } as CodexActivityCardProps
    render(<CodexActivityCard {...props} />)
    expect(screen.getByText('Codex · Finished')).toBeTruthy()
    expect(screen.queryByText('Source command detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Run command' }))
    expect(screen.getByText('Source command detail')).toBeTruthy()
    expect(screen.queryByText(/succeeded|success/i)).toBeNull()
  })
})
