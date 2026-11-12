/** Native Axiom continuation through observed original-site messages, without model API calls. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { HarnessError, LlmAdapter, type GenerateOptions, type LlmModelInfo, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AxiomBinding, AxiomHistory, AxiomMessage, AxiomSnapshot, AxiomTransport } from './axiom-types.ts'

/** Operation-specific bindings and validated deployment timing. */
export interface AxiomAdapterDependencies {
  /** @param sessionId Harness Session being continued. @returns Its exact original Axiom binding, when present. */
  bindingOf(sessionId: SessionId): AxiomBinding | undefined
  /** @returns The current owned Desktop transport, absent outside Desktop. */
  transport(): AxiomTransport | undefined
  readonly pollIntervalMs: number
  readonly responseTimeoutMs: number
  readonly settleMs: number
  /** @param sessionId Continued Session. @param snapshot Latest observed page. @param sentMessageId Confirmed user message. @param assistantIds Original assistant ids already emitted. @returns After durable observation bookkeeping. */
  onCommitted?(sessionId: SessionId, snapshot: AxiomSnapshot, sentMessageId: string, assistantIds: readonly string[]): void | Promise<void>
}

function matchingPage(snapshot: AxiomSnapshot, binding: AxiomBinding): void {
  if (snapshot.url?.replace(/\/$/u, '') !== binding.url.replace(/\/$/u, '')) {
    throw new HarnessError('The original Axiom page changed. Open the conversation before continuing.', 'AXIOM_PAGE_CHANGED')
  }
}

/**
 * Read only the currently rendered original messages under an exclusive page lease.
 * @param transport Owned page transport.
 * @param binding Exact original conversation to inspect.
 * @param signal Cancels this read without changing the original conversation.
 * @returns Stable original message ids and an explicitly incomplete history window.
 */
export async function readAxiomHistory(transport: AxiomTransport, binding: AxiomBinding, signal?: AbortSignal): Promise<AxiomHistory> {
  const release = await transport.acquire(signal)
  try {
    const snapshot = await transport.connect(binding.url, signal)
    matchingPage(snapshot, binding)
    return { sourceId: binding.sourceId, url: binding.url, title: snapshot.title, phase: snapshot.phase,
      messages: snapshot.messages, limited: true }
  } finally { release() }
}

function userText(options: GenerateOptions): string {
  const index = options.messages.findLastIndex(item => item.role === 'user'
    && (!('source' in item) || item.source?.kind === 'user'))
  const message = options.messages[index]
  if (message === undefined || message.content.some(block => block.type !== 'text')
    || options.messages.slice(index + 1).some(item => item.role === 'assistant' || item.role === 'tool' || item.role === 'user')) {
    throw new HarnessError('Axiom continuation requires a new text-only user message.', 'AXIOM_TEXT_REQUIRED')
  }
  const text = message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
  if (text.trim() === '') throw new HarnessError('Axiom continuation requires a nonempty user message.', 'AXIOM_TEXT_REQUIRED')
  return text
}

/** Continue the exact original Dot; auxiliary model calls never reach its composer. */
export class AxiomAdapter extends LlmAdapter {
  /** @param deps Exact bindings, owned transport, observation callback, and validated polling limits. */
  constructor(private readonly deps: AxiomAdapterDependencies) { super() }

  override providerInfo(provider: string) { return { id: provider, name: 'Axiom · ChatGPT' } }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    // A repeated site submission can duplicate an action, even after an unknown result.
    return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'original-dot', name: 'Original Axiom conversation', inputModalities: ['text'] }])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== undefined) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AXIOM_AUXILIARY_UNSUPPORTED',
        message: 'Auxiliary model requests cannot submit to the original Axiom conversation.' } } }
      return
    }
    const sessionId = options.sessionId
    const binding = sessionId === undefined ? undefined : this.deps.bindingOf(sessionId)
    const transport = this.deps.transport()
    if (binding === undefined || sessionId === undefined || transport === undefined) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AXIOM_UNAVAILABLE',
        message: 'The original Axiom conversation or its Desktop bridge is unavailable.' } } }
      return
    }
    const timeout = new AbortController()
    const timer = setTimeout(() => { timeout.abort() }, this.deps.responseTimeoutMs)
    const deadline = timeout.signal
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
    let release: (() => void) | undefined
    try {
      const text = userText(options)
      release = await transport.acquire(signal)
      signal.throwIfAborted()
      const before = await transport.connect(binding.url, signal)
      matchingPage(before, binding)
      if (before.phase !== 'ready' || !before.canSend || before.draftPresent || before.siteStatus !== null) {
        throw new HarnessError('The original Axiom page is not ready or contains an existing draft. Open it in ChatGPT.', 'AXIOM_NOT_READY')
      }
      const oldIds = new Set(before.messages.map(message => message.id))
      const result = await transport.send({ requestId: randomUUID(), revision: before.revision, text }, signal)
      if (result.status !== 'confirmed' || result.messageId === undefined || oldIds.has(result.messageId)) {
        throw new HarnessError(result.status === 'unknown'
          ? 'The original page did not confirm whether the message was sent. Check ChatGPT before sending again.'
          : 'The original page refused this submission. Check its login, draft, and send controls.',
        result.status === 'unknown' ? 'AXIOM_SEND_UNKNOWN' : 'AXIOM_SEND_REFUSED')
      }
      const sentId = result.messageId
      const observed = new Map<string, { index: number; text: string }>()
      let snapshot = result.snapshot
      matchingPage(snapshot, binding)
      await this.deps.onCommitted?.(sessionId, snapshot, sentId, [])
      let changedAt = Date.now()
      let readySince: number | undefined
      while (true) {
        signal.throwIfAborted()
        matchingPage(snapshot, binding)
        if (snapshot.phase !== 'ready') throw new HarnessError('The original Axiom page became unavailable. Check ChatGPT.', 'AXIOM_PAGE_UNAVAILABLE')
        const marker = snapshot.messages.findIndex(message => message.id === sentId && message.role === 'user')
        if (marker < 0) throw new HarnessError('The sent message left the visible source window. Check ChatGPT for the result.', 'AXIOM_VISIBLE_WINDOW_LOST')
        const following = snapshot.messages.slice(marker + 1)
        if (following.some(message => message.role === 'user')) {
          throw new HarnessError('Another original-site user message appeared while waiting. Check ChatGPT for the result.', 'AXIOM_CONVERSATION_CHANGED')
        }
        const replies: readonly AxiomMessage[] = following.filter(message => message.role === 'assistant' && !oldIds.has(message.id))
        for (const reply of replies) {
          if (reply.truncated) throw new HarnessError('The original assistant message exceeds the visible source limit. Read it in ChatGPT.', 'AXIOM_RESPONSE_LIMITED')
          const prior = observed.get(reply.id)
          if (prior !== undefined && !reply.text.startsWith(prior.text)) {
            throw new HarnessError('The original assistant message changed earlier text. Read the result in ChatGPT.', 'AXIOM_RESPONSE_REWRITTEN')
          }
          if (reply.text === '') continue
          const entry = prior ?? { index: observed.size, text: '' }
          if (prior === undefined) {
            observed.set(reply.id, entry)
            yield { type: 'block-start', index: entry.index, blockType: 'text' }
          }
          const suffix = reply.text.slice(entry.text.length)
          if (suffix !== '') {
            entry.text = reply.text
            changedAt = Date.now()
            yield { type: 'text-delta', index: entry.index, text: suffix }
            await this.deps.onCommitted?.(sessionId, snapshot, sentId, [...observed.keys()])
          }
        }
        if (observed.size > 0 && snapshot.canSend && snapshot.siteStatus === null) readySince ??= Date.now()
        else readySince = undefined
        if (readySince !== undefined && Date.now() - Math.max(changedAt, readySince) >= this.deps.settleMs) {
          for (const entry of observed.values()) yield { type: 'block-end', index: entry.index, block: { type: 'text', text: entry.text } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        await delay(this.deps.pollIntervalMs, undefined, { signal })
        snapshot = await transport.snapshot(signal)
      }
    } catch (error) {
      const aborted = options.signal?.aborted === true
      yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure: {
        code: aborted ? 'AXIOM_OBSERVATION_CANCELLED' : deadline.aborted ? 'AXIOM_RESPONSE_TIMEOUT'
          : error instanceof HarnessError ? error.code : 'AXIOM_BRIDGE_FAILED',
        message: signal.aborted
          ? 'Observation of the original Axiom response stopped. Its work may continue in ChatGPT; check there before sending again.'
          : error instanceof Error ? error.message : 'The original Axiom page could not be observed. Check ChatGPT before sending again.',
      } } }
    } finally { clearTimeout(timer); release?.() }
  }
}
