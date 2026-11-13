/** Dedicated original-site conversation state; no Agent, Session, Host send, or LLM request is created. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopAxiomCompanion, DotIdentity, DotMessage, DotPreferences, DotSnapshot } from './desktop-axiom.ts'
import { mergeDotMessages } from './dot-history.ts'

/** Source observations and shared interaction state for the continuous Dot surface. */
export interface DotState {
  readonly preferences: DotPreferences | null
  readonly selection: DotIdentity | null
  readonly snapshot: DotSnapshot | null
  readonly messages: readonly DotMessage[]
  readonly busy: boolean
  readonly pending: boolean
  readonly failed: boolean
  readonly preferencesFailed: boolean
  readonly history: 'idle' | 'loading' | 'ready' | 'unavailable'
  readonly hasMore: boolean
  readonly draft: string
  readonly sending: boolean
  readonly sendOutcome: 'confirmed' | 'unknown' | 'refused' | 'failed' | null
}

/** Read-only empty state for a Web client without the desktop capability. */
export const emptyDotState: DotState = { preferences: null, selection: null, snapshot: null, messages: [], busy: false,
  pending: false, failed: false, preferencesFailed: false, history: 'idle', hasMore: true, draft: '', sending: false, sendOutcome: null }

/** Dedicated Dot actions, independent of the regular workspace/session navigation. */
export interface DotController {
  readonly store: SnapshotStore<DotState>
  setPreferences(preferences: DotPreferences): Promise<void>
  open(fallbackUrl?: string): Promise<void>
  configure(): Promise<void>
  loadOlder(): Promise<void>
  setDraft(text: string): void
  send(): Promise<void>
  showOriginal(): Promise<void>
  dispose(): void
}

/**
 * Observe and operate the selected original Dot directly through the trusted desktop bridge.
 * @param companion - Validated desktop website operations and private preferences.
 * @returns The continuous source conversation and explicit user actions; observations never navigate.
 */
export function createDotController(companion: DesktopAxiomCompanion): DotController {
  const store = createSnapshotStore<DotState>(emptyDotState)
  let active = true
  let generation = 0
  let choosing = false
  let observationSequence = 0
  let queuedSnapshot: DotSnapshot | null = null
  const queuedObservation = (): DotSnapshot | null => queuedSnapshot
  const currentAttempt = (attempt: number, url?: string | null): boolean =>
    active && attempt === generation && (url === undefined || store.getSnapshot().snapshot?.url === url)
  const update = (patch: Partial<DotState>): void => { if (active) store.set({ ...store.getSnapshot(), ...patch }) }
  const observe = (snapshot: DotSnapshot): void => {
    if (!active) return
    const state = store.getSnapshot()
    if (state.preferences?.enabled === false) return
    const same = snapshot.url === state.selection?.url
    if (same && state.snapshot?.phase === 'ready' && snapshot.phase === 'ready'
      && snapshot.revision < state.snapshot.revision) return
    if (snapshot.phase === 'disconnected' && state.snapshot?.phase !== 'disconnected'
      || snapshot.url !== null && state.selection !== null && !same) generation++
    const selection = snapshot.url === null ? state.selection : { url: snapshot.url, title: snapshot.title || state.selection?.title || '' }
    update({ snapshot, selection,
      messages: snapshot.url === null ? state.messages : mergeDotMessages(same ? state.messages : [], snapshot.messages, 'live'),
      ...snapshot.phase === 'disconnected' ? { sending: false,
        sendOutcome: state.sending ? 'unknown' : state.sendOutcome,
        history: state.history === 'loading' ? 'unavailable' : state.history } : {},
      pending: snapshot.phase === 'loading' || snapshot.phase === 'login-required',
      failed: snapshot.phase === 'unavailable',
      ...snapshot.url !== null && state.selection !== null && !same
        ? { history: 'idle', hasMore: true, draft: '', sending: false, sendOutcome: state.sending ? 'unknown' : null } : {},
    })
  }
  const off = companion.subscribe((snapshot) => {
    observationSequence++
    if (!choosing) { observe(snapshot); return }
    if (snapshot.phase === 'ready' && snapshot.url !== null
      && (queuedSnapshot?.url !== snapshot.url || queuedSnapshot.revision <= snapshot.revision)) queuedSnapshot = snapshot
  })
  const acceptsInitialRead = (): boolean => active && store.getSnapshot().preferences?.enabled === true
  const ready = Promise.all([companion.preferences(), companion.selection()]).then(async ([preferences, selection]) => {
    update({ preferences, selection: store.getSnapshot().selection ?? selection })
    if (!acceptsInitialRead()) return
    const sequence = observationSequence
    try {
      const snapshot = await companion.snapshot()
      if (!acceptsInitialRead()) return
      const observed = store.getSnapshot().snapshot
      // A source event wins across identity or lifecycle changes; only a newer same-source read may replace it.
      if (observationSequence !== sequence && observed !== null
        && (observed.url !== snapshot.url || observed.revision >= snapshot.revision)) return
      observe(snapshot)
    } catch (_initialSnapshotFailed: unknown) {
      if (acceptsInitialRead() && observationSequence === sequence) update({ failed: true })
    }
  }).catch(() => { update({ preferencesFailed: true }) })
  const configure = async (reuse: boolean, fallbackUrl?: string): Promise<void> => {
    await ready
    if (!active || choosing || store.getSnapshot().sending || store.getSnapshot().history === 'loading'
      || !store.getSnapshot().preferences?.enabled) return
    choosing = true
    queuedSnapshot = null
    const attempt = ++generation
    update({ busy: true, failed: false, sendOutcome: null })
    try {
      const current = reuse ? await companion.snapshot() : null
      const snapshot = current?.phase === 'ready' && current.url !== null
        ? current : await companion.choose(store.getSnapshot().selection?.url ?? fallbackUrl ?? null)
      const selected = snapshot.url === null && queuedObservation() !== null ? await companion.selection() : null
      if (currentAttempt(attempt)) {
        const queued = queuedObservation()
        observe(snapshot)
        if (queued !== null && queued.url === (snapshot.url ?? selected?.url)
          && (snapshot.phase !== 'ready' || queued.revision >= snapshot.revision)) observe(queued)
      }
    } catch (_selectionFailed: unknown) { update({ failed: true, pending: false }) }
    finally { choosing = false; update({ busy: false }) }
  }
  return {
    store,
    async setPreferences(preferences): Promise<void> {
      await companion.setPreferences(preferences)
      if (!preferences.enabled) { generation++; update({ pending: false, snapshot: null, sending: false, history: 'idle' }) }
      update({ preferences })
    },
    open: async (fallbackUrl) => { await configure(true, fallbackUrl) },
    configure: async () => { await configure(false) },
    setDraft(text): void { update({ draft: text }) },
    async loadOlder(): Promise<void> {
      const state = store.getSnapshot()
      const first = state.messages[0]
      if (!active || first === undefined || !state.hasMore || state.history === 'loading' || state.snapshot?.phase !== 'ready') return
      const selected = state.snapshot.url
      const attempt = generation
      update({ history: 'loading' })
      try {
        const page = await companion.historyBefore(first.id)
        if (!currentAttempt(attempt, selected)) return
        const messages = mergeDotMessages(store.getSnapshot().messages, page.messages, 'older')
        const status = page.status === 'ready' && page.hasMore && messages[0]?.id === first.id ? 'unavailable' : page.status
        update({ messages, history: status, hasMore: status === 'unavailable' ? true : page.hasMore })
      } catch (_historyFailed: unknown) {
        if (currentAttempt(attempt, selected)) {
          update({ history: 'unavailable', hasMore: true })
        }
      }
    },
    async send(): Promise<void> {
      const state = store.getSnapshot()
      const snapshot = state.snapshot
      if (!active || state.sending || !state.preferences?.enabled || !state.draft.trim()
        || snapshot?.phase !== 'ready' || !snapshot.canSend || snapshot.draftPresent) return
      const text = state.draft
      const attempt = generation
      update({ sending: true, sendOutcome: null })
      try {
        const result = await companion.send({ requestId: randomUUID(), revision: snapshot.revision, text })
        if (!currentAttempt(attempt)) return
        observe(result.snapshot)
        update({ sendOutcome: result.status, ...result.status === 'confirmed' && store.getSnapshot().draft === text ? { draft: '' } : {} })
      } catch (_sendFailed: unknown) { if (currentAttempt(attempt)) update({ sendOutcome: 'unknown' }) }
      finally { if (currentAttempt(attempt)) update({ sending: false }) }
    },
    showOriginal: async () => { await companion.showLogin() },
    dispose(): void { active = false; generation++; off() },
  }
}
