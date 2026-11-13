/** Explicit Dot selection and accepted desktop preferences shared by Settings and navigation. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopAxiomCompanion, DotPreferences, DotSelection } from './desktop-axiom.ts'

/** Accepted preferences and shared interaction feedback; no website messages are stored here. */
export interface DotState {
  readonly preferences: DotPreferences | null
  readonly busy: boolean
  readonly pending: boolean
  readonly failed: boolean
  readonly preferencesFailed: boolean
}

/**
 * Own the armed selection for one plugin lifetime; page observation alone never navigates.
 * @param companion - Desktop preference storage and explicit website chooser.
 * @param operations - Canonical binding reader and guarded native Session connection.
 * @returns Shared interaction state, preference and selection actions, and a lifetime disposer.
 */
export function createDotController(companion: DesktopAxiomCompanion, operations: {
  preferredUrl(): Promise<string | null>
  connect(url: string, isCurrent: () => boolean): Promise<void>
}): {
  store: ReturnType<typeof createSnapshotStore<DotState>>
  setPreferences(preferences: DotPreferences): Promise<void>
  choose(): Promise<void>
  dispose(): void
} {
  const store = createSnapshotStore<DotState>({ preferences: null, busy: false, pending: false, failed: false, preferencesFailed: false })
  let active = true
  let armed = false
  let opening = false
  let generation = 0
  let startingAttempt: number | null = null
  const update = (patch: Partial<DotState>): void => { if (active) store.set({ ...store.getSnapshot(), ...patch }) }
  const fail = (): void => { armed = false; update({ busy: false, pending: false, failed: true }) }
  const isCurrent = (attempt: number): boolean => active && armed && attempt === generation
  const accept = async (snapshot: DotSelection, attempt: number): Promise<void> => {
    if (!isCurrent(attempt) || opening) return
    if (snapshot.phase !== 'ready' || snapshot.url === null) {
      if (snapshot.phase === 'unavailable' || snapshot.phase === 'disconnected') fail()
      else update({ busy: false, pending: true })
      return
    }
    const url = new URL(snapshot.url)
    if (url.origin !== 'https://chatgpt.com' || !/^\/dots\/[A-Za-z0-9_~-]+\/?$/.test(url.pathname)
      || url.search || url.hash || url.username || url.password) { fail(); return }
    opening = true
    armed = false
    try {
      await operations.connect(url.href, () => active && attempt === generation && store.getSnapshot().preferences?.enabled === true)
      update({ busy: false, pending: false })
    }
    catch (_connectionFailed: unknown) { fail() }
    finally { opening = false }
  }
  const off = companion.subscribe((snapshot) => {
    // The chooser's result supersedes transient teardown events from replacing its previous page.
    if (startingAttempt === generation) return
    void accept(snapshot, generation).catch(fail)
  })
  const ready = companion.preferences().then((preferences) => { update({ preferences }) })
    .catch(() => { update({ preferencesFailed: true }) })
  return {
    store,
    async setPreferences(preferences: DotPreferences): Promise<void> {
      if (!preferences.enabled) { armed = false; generation++; update({ pending: false }) }
      await companion.setPreferences(preferences)
      update({ preferences })
    },
    async choose(): Promise<void> {
      await ready
      if (!active || opening || armed || !store.getSnapshot().preferences?.enabled) return
      armed = true
      const attempt = ++generation
      startingAttempt = attempt
      update({ busy: true, pending: false, failed: false, preferencesFailed: false })
      try {
        const hint = await operations.preferredUrl()
        if (!isCurrent(attempt)) return
        const snapshot = await companion.choose(hint)
        if (startingAttempt === attempt) startingAttempt = null
        await accept(snapshot, attempt)
      } catch (_selectionFailed: unknown) { if (attempt === generation) fail() }
      finally { if (startingAttempt === attempt) startingAttempt = null }
    },
    dispose(): void { active = false; armed = false; generation++; off() },
  }
}
