/** Original-page adapter fixtures: observed text only, confirmed sends, and no mutation on auxiliary calls. */
import { expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { AxiomAdapter, readAxiomHistory } from '../src/axiom.ts'
import type { AxiomMessage, AxiomSendResult, AxiomSnapshot, AxiomTransport } from '../src/axiom-types.ts'
import type { NativeConversationId } from '../src/types.ts'

const url = 'https://chatgpt.com/dots/original~opaque'
const sessionId = SessionId('axiom-fixture')
const sourceId = 'original-binding' as NativeConversationId
const old: AxiomMessage[] = [
  { id: 'old-user', role: 'user', text: 'Earlier question', timestamp: null, truncated: false },
  { id: 'old-answer', role: 'assistant', text: 'Do not replay this answer.', timestamp: null, truncated: false },
]
function snapshot(messages: readonly AxiomMessage[] = old): AxiomSnapshot {
  return { source: 'chatgpt-web', url, title: 'Original Axiom', revision: 1, phase: 'ready', messages,
    canSend: true, draftPresent: false, siteStatus: null, limited: false }
}
function fixture(result?: AxiomSendResult) {
  const release = vi.fn()
  const sent: AxiomMessage = { id: 'new-user', role: 'user', text: 'Continue the real conversation.', timestamp: null, truncated: false }
  const assistant: AxiomMessage = { id: 'new-answer', role: 'assistant', text: 'Observed original answer.', timestamp: null, truncated: false }
  const transport: AxiomTransport = {
    acquire: vi.fn(async () => release), connect: vi.fn(async () => snapshot()),
    snapshot: vi.fn(async () => snapshot([...old, sent, assistant])),
    send: vi.fn(async () => result ?? { status: 'confirmed', messageId: sent.id, snapshot: snapshot([...old, sent]) }),
    showLogin: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
  }
  const committed = vi.fn()
  const adapter = new AxiomAdapter({
    bindingOf: () => ({ sourceId, url }), transport: () => transport,
    pollIntervalMs: 1, responseTimeoutMs: 1000, settleMs: 0, onCommitted: committed,
  })
  const options: GenerateOptions = { provider: 'axiom', model: 'original-dot', sessionId,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: sent.text }] })] }
  return { adapter, transport, options, release, committed }
}
async function chunks(adapter: AxiomAdapter, options: GenerateOptions): Promise<StreamChunk[]> {
  const result: StreamChunk[] = []
  for await (const chunk of adapter.stream(options)) result.push(chunk)
  return result
}

it('sends only new user text once and emits only new observed assistant text', async () => {
  const source = fixture()
  const output = await chunks(source.adapter, source.options)
  expect(source.transport.send).toHaveBeenCalledTimes(1)
  expect(source.transport.send).toHaveBeenCalledWith(expect.objectContaining({ text: 'Continue the real conversation.', revision: 1 }), expect.any(AbortSignal))
  expect(output.filter(chunk => chunk.type === 'text-delta')).toEqual([{ type: 'text-delta', index: 0, text: 'Observed original answer.' }])
  expect(output.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  expect(source.committed).toHaveBeenLastCalledWith(sessionId, expect.any(Object), 'new-user', ['new-answer'])
  expect(source.release).toHaveBeenCalledTimes(1)
})

it('never retries or polls a send with an unknown original-site acknowledgement', async () => {
  const source = fixture({ status: 'unknown', snapshot: snapshot() })
  const output = await chunks(source.adapter, source.options)
  expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'AXIOM_SEND_UNKNOWN' } } })
  expect(source.transport.send).toHaveBeenCalledTimes(1)
  expect(source.transport.snapshot).not.toHaveBeenCalled()
  expect(source.adapter.providerRetryPolicy()).toMatchObject({ maxRetries: 0 })
  expect(source.release).toHaveBeenCalledTimes(1)
})

it('auxiliary calls cannot navigate or send to the original conversation', async () => {
  const source = fixture()
  const options = { ...source.options, purpose: 'compaction' } as GenerateOptions
  expect((await chunks(source.adapter, options)).at(-1)).toMatchObject({ reason: { kind: 'error', failure: { code: 'AXIOM_AUXILIARY_UNSUPPORTED' } } })
  expect(source.transport.acquire).not.toHaveBeenCalled()
  expect(source.transport.connect).not.toHaveBeenCalled()
  expect(source.transport.send).not.toHaveBeenCalled()
})

it('cannot replay an earlier human prompt after its assistant response', async () => {
  const source = fixture()
  source.options.messages.push(createAssistantMessage({ source: { provider: 'axiom', model: 'original-dot' },
    content: [{ type: 'text', text: 'An already completed original answer.' }] }))
  expect((await chunks(source.adapter, source.options)).at(-1)).toMatchObject({ reason: { kind: 'error', failure: { code: 'AXIOM_TEXT_REQUIRED' } } })
  expect(source.transport.acquire).not.toHaveBeenCalled()
  expect(source.transport.send).not.toHaveBeenCalled()
})

it('cancellation stops local observation without stopping or closing the source page', async () => {
  const source = fixture()
  const abort = new AbortController()
  abort.abort()
  const output = await chunks(source.adapter, { ...source.options, signal: abort.signal })
  expect(output.at(-1)).toMatchObject({ reason: { kind: 'aborted' } })
  expect(source.transport.send).not.toHaveBeenCalled()
  expect(source.transport.disconnect).not.toHaveBeenCalled()
})

it('history hydration preserves original stable ids and reports only a rendered window', async () => {
  const source = fixture()
  const history = await readAxiomHistory(source.transport, { sourceId, url })
  expect(history).toMatchObject({ sourceId: 'original-binding', url, messages: old, limited: true })
  expect(source.transport.send).not.toHaveBeenCalled()
  expect(source.release).toHaveBeenCalledTimes(1)
})

it('cancellation after a confirmed send never retries or stops the original work', async () => {
  const source = fixture()
  const abort = new AbortController()
  vi.mocked(source.transport.snapshot).mockImplementationOnce(async () => {
    abort.abort()
    return snapshot()
  })
  const output = await chunks(source.adapter, { ...source.options, signal: abort.signal })
  expect(output.at(-1)).toMatchObject({ reason: { kind: 'aborted', failure: { code: 'AXIOM_OBSERVATION_CANCELLED' } } })
  expect(source.transport.send).toHaveBeenCalledTimes(1)
  expect(source.transport.disconnect).not.toHaveBeenCalled()
  expect(source.release).toHaveBeenCalledTimes(1)
})
