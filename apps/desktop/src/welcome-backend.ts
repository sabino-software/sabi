import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
/** Native welcome operations using the shared Web authentication and RPC APIs. */

import { randomUUID } from 'node:crypto'
import type { WelcomeNativeProvider } from './welcome-api.ts'
import { desktopAccountBackend, type DesktopAccountBackend } from './account-backend.ts'

/** Metadata needed before the native entry or workspace becomes visible. */
export interface WelcomeState {
  readonly loggedIn: boolean
  /** A provider API key or a stored provider sign-in is configured; no secret values are read. */
  readonly hasApiKey: boolean
  /** A connected, authenticated native provider is selected as the profile default. */
  readonly nativeReady: boolean
  readonly writable: boolean
  readonly localePreference: string | null
  /** Effective Host theme preference; absent or invalid optional theme settings use system appearance. */
  readonly themePreference: 'light' | 'dark' | 'system'
}

/** Narrow operations available to the native welcome flow. */
export interface DesktopWelcomeBackend {
  /** @returns Native work-account availability, or null outside the native composition. */
  nativeProvider(): Promise<WelcomeNativeProvider | null>
  /** @returns Whether the source owner saved the work Codex default and confirmed readiness. */
  useCodex(): Promise<{ ok: boolean }>
  /** @returns the current Host policy; every read observes live configuration. */
  analyticsEnabled(): Promise<boolean>
  readonly account: DesktopAccountBackend
  /** @param event - desktop-owned fields. @returns after local Host intake. */
  report(event: ProductEvent): Promise<void>
  /** @returns Configured provider credential presence and shared preferences, without credential values. */
  read(): Promise<WelcomeState>
  /** @returns The saved UI language without account or provider requests. */
  readLocalePreference(): Promise<string | null>
  /**
   * @param apiKey - User-entered official provider key.
   * @returns A safe write outcome without provider diagnostics.
   */
  save(apiKey: string): Promise<{ ok: boolean }>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Connect the native HTTP client to the Desktop Host; every request sends `cookie` explicitly and uses no cookie jar.
 * @param hostUrl - URL of the running Desktop Host; only its origin is used.
 * @param cookie - Cookie header returned by `authenticateWebHost` for this Host.
 * @param send - HTTP client for Host requests.
 * @param options - Explicit native composition; ordinary profiles never query its optional service.
 * @returns metadata reads and write-only credential operations over standard RPC.
 */
export function connectDesktopWelcome(
  hostUrl: string,
  cookie: string,
  send: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  options: { readonly nativeConversations?: boolean } = {},
): DesktopWelcomeBackend {
  const origin = new URL(hostUrl).origin
  const invoke = async (
    request: { namespace: string; method: string; args: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', redirect: 'error', ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) throw new Error('desktop welcome: Web request failed')
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error('desktop welcome: Web RPC failed')
    }
    return envelope.result.value
  }
  const account = desktopAccountBackend(origin, invoke, cookie)
  const settingsAndReference = async () => {
    const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
    if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
    const official: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'llm-deepseek')
    if (official === undefined) return { settings: { namespaces: settings.namespaces }, ref: undefined }
    if (!record(official) || !record(official.value) || typeof official.value.apiKeyEnv !== 'string') {
      throw new Error('desktop welcome: missing official DeepSeek credential reference')
    }
    return { settings: { namespaces: settings.namespaces }, ref: official.value.apiKeyEnv }
  }
  const localePreference = (namespaces: unknown[]): string | null => {
    const locale: unknown = namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('desktop welcome: invalid locale preference')
    }
    return locale.value.preference ?? null
  }
  const themePreference = (namespaces: unknown[]): WelcomeState['themePreference'] => {
    const theme = namespaces.find(item => record(item) && item.ns === 'ui-theme')
    if (theme === undefined) return 'system'
    const preference = record(theme) && record(theme.value) ? theme.value.preference : undefined
    if (preference === 'light' || preference === 'dark' || preference === 'system') return preference
    console.warn('desktop appearance: invalid Host theme preference; using system appearance')
    return 'system'
  }
  const nativeProvider = async (): Promise<WelcomeNativeProvider | null> => {
    if (options.nativeConversations !== true) return null
    try {
      const status = await invoke({ namespace: 'nativeConversations', method: 'status', args: {} }, AbortSignal.timeout(5000))
      if (!record(status) || !record(status.codex) || typeof status.codex.connected !== 'boolean'
        || typeof status.codex.authenticated !== 'boolean' || typeof status.codex.selected !== 'boolean') {
        throw new Error('desktop welcome: invalid native provider metadata')
      }
      const available = status.codex.connected && status.codex.authenticated
      return { available, ready: available && status.codex.selected }
    } catch (_unavailableNativeProvider) {
      return { available: false, ready: false }
    }
  }
  const read = async (): Promise<WelcomeState> => {
    const { settings, ref } = await settingsAndReference()
    const providers = await invoke({ namespace: 'llm', method: 'listConfigurableProviders', args: {} })
    if (!Array.isArray(providers)) throw new Error('desktop welcome: invalid provider directory')
    const namespaces = settings.namespaces
    const refs = providers.flatMap((provider: unknown) => {
      if (!record(provider) || typeof provider.settingsNs !== 'string' || !Array.isArray(provider.settingsPath)) {
        throw new Error('desktop welcome: invalid provider settings address')
      }
      const namespace: unknown = namespaces.find((item: unknown) => record(item) && item.ns === provider.settingsNs)
      let value: unknown = record(namespace) ? namespace.value : undefined
      for (const key of provider.settingsPath as unknown[]) {
        if (typeof key !== 'string') throw new Error('desktop welcome: invalid provider settings path')
        value = record(value) ? value[key] : undefined
      }
      return record(value) && typeof value.apiKeyEnv === 'string' ? [value.apiKeyEnv] : []
    })
    const unique = [...new Set([...(ref === undefined ? [] : [ref]), ...refs])]
    const states: Record<string, unknown> = {}
    // credentials.describe accepts at most 64 references per request.
    for (let offset = 0; offset < unique.length; offset += 64) {
      const batch = await invoke({ namespace: 'credentials', method: 'describe', args: { refs: unique.slice(offset, offset + 64) } })
      if (!record(batch)) throw new Error('desktop welcome: invalid credential metadata')
      Object.assign(states, batch)
    }
    if (ref !== undefined && !record(states[ref])) throw new Error('desktop welcome: missing credential metadata')
    const authorizations = await invoke({ namespace: 'authorization', method: 'list', args: {} })
    if (!Array.isArray(authorizations) || authorizations.some((entry: unknown) =>
      !record(entry) || typeof entry.configured !== 'boolean')) {
      throw new Error('desktop welcome: invalid provider sign-in metadata')
    }
    const hasProviderSignIn = authorizations.some((entry: unknown) => record(entry) && entry.configured === true)
    return {
      loggedIn: (await account.state()).status === 'credential-stored',
      nativeReady: (await nativeProvider())?.ready === true,
      hasApiKey: hasProviderSignIn || Object.values(states).some(value => record(value) && value.configured === true),
      writable: ref !== undefined && record(states[ref]) && states[ref].writable === true,
      localePreference: localePreference(namespaces),
      themePreference: themePreference(namespaces),
    }
  }
  return {
    account,
    read,
    nativeProvider,
    async useCodex() {
      if (!(await nativeProvider())?.available) return { ok: false }
      try {
        await invoke({ namespace: 'nativeConversations', method: 'useCodex', args: {} }, AbortSignal.timeout(15000))
        return { ok: (await nativeProvider())?.ready === true }
      } catch (_nativeSelectionFailed) { return { ok: false } }
    },
    async analyticsEnabled() {
      const enabled = await invoke({ namespace: 'productAnalytics', method: 'enabled', args: {} }, AbortSignal.timeout(1000))
      if (typeof enabled !== 'boolean') throw new Error('desktop analytics: invalid collection policy')
      return enabled
    },
    async report(event) { await invoke({ namespace: 'productAnalytics', method: 'report', args: { event } }, AbortSignal.timeout(1000)) },
    async readLocalePreference() {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
      return localePreference(settings.namespaces)
    },
    async save(apiKey) {
      if (!/^[\x21-\x7e]+$/.test(apiKey)) return { ok: false }
      try {
        const { ref } = await settingsAndReference()
        if (ref === undefined) return { ok: false }
        await invoke({ namespace: 'credentials', method: 'set', args: { ref, value: apiKey } })
        return { ok: true }
      } catch {
        // Provider diagnostics may contain credentials; the native form owns failure copy.
        return { ok: false }
      }
    },
  }
}
