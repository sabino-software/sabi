/** Structural desktop capability detection; this Client never imports the Electron application. */
import { z } from 'zod'

/** Website connection selected by the desktop user. */
export type AxiomTransportMode = 'browser' | 'embedded'

/** Local manual-setup metadata, without website credentials or an installation operation. */
export interface AxiomBrowserSetup {
  readonly available: boolean
  readonly extensionDirectory: string
  readonly registrationScript: string
  readonly nativeHostScript: string
  readonly nodeExecutable: string
  readonly hostName: string
  readonly extensionId: string
  readonly permissions: readonly ['activeTab', 'scripting', 'nativeMessaging']
}

/** Closed appearance choices; every option retains the shared New Session geometry. */
export type DotSidebarStyle = 'sameNewSession' | 'subtle' | 'outline'

/** Accepted desktop preferences; sidebar visibility is independent of integration enablement. */
export interface DotPreferences { readonly enabled: boolean; readonly showInSidebar: boolean; readonly sidebarStyle: DotSidebarStyle }

/** Original rendered message identity and content, never synthesized by the client. */
export interface DotMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp: string | null
  readonly truncated: boolean
}

/** Selected original Dot, retained without opening a page. */
export interface DotIdentity { readonly url: string; readonly title: string }

/** Full bounded original-site observation used directly by the dedicated Dot view. */
export interface DotSnapshot {
  readonly source: 'chatgpt-web'
  readonly url: string | null
  readonly title: string
  readonly revision: number
  readonly phase: 'disconnected' | 'loading' | 'login-required' | 'ready' | 'unavailable'
  readonly messages: readonly DotMessage[]
  /** Original row order before temporary body omissions, bounded to this source window. */
  readonly sourceOrder?: readonly string[]
  readonly canSend: boolean
  readonly draftPresent: boolean
  readonly siteStatus: string | null
  readonly limited: boolean
  readonly errorCode?: 'page-unavailable' | 'unsupported-page' | undefined
}

/** User-authored submission, admitted once at the observed source revision. */
export interface DotSendRequest { readonly requestId: string; readonly revision: number; readonly text: string }

/** Observed source acknowledgement; an unknown outcome is never automatically retried. */
export interface DotSendResult {
  readonly status: 'confirmed' | 'unknown' | 'refused'
  readonly snapshot: DotSnapshot
  readonly messageId?: string | undefined
}

/** Older source page in chronological order; unavailable never means history exhaustion. */
export interface DotHistoryPage {
  readonly messages: readonly DotMessage[]
  /** Original row order before temporary body omissions, bounded to this source window. */
  readonly sourceOrder?: readonly string[]
  readonly hasMore: boolean
  readonly status: 'ready' | 'unavailable'
}

/** Minimal selection state retained for compatibility with selection-only fixtures. */
export type DotSelection = Pick<DotSnapshot, 'url' | 'phase'>

/** Optional owner-window operations; changing mode is always an explicit user action. */
export interface DesktopAxiomCompanion {
  readonly preferences: () => Promise<DotPreferences>
  readonly setPreferences: (preferences: DotPreferences) => Promise<void>
  readonly choose: (hintUrl: string | null) => Promise<DotSnapshot>
  readonly subscribe: (listener: (snapshot: DotSnapshot) => void) => () => void
  readonly selection: () => Promise<DotIdentity | null>
  readonly snapshot: () => Promise<DotSnapshot>
  readonly send: (request: DotSendRequest) => Promise<DotSendResult>
  readonly historyBefore: (beforeId: string) => Promise<DotHistoryPage>
  readonly showLogin: () => Promise<void>
  readonly transport: () => Promise<AxiomTransportMode>
  readonly selectTransport: (mode: AxiomTransportMode) => Promise<void>
  readonly browserSetup: () => Promise<AxiomBrowserSetup>
}

const preferencesSchema = z.object({ enabled: z.boolean(), showInSidebar: z.boolean(),
  sidebarStyle: z.enum(['sameNewSession', 'subtle', 'outline']).default('sameNewSession'),
}).strict()
const messageSchema = z.object({ id: z.string().min(1).max(512), role: z.enum(['user', 'assistant']),
  text: z.string().max(32768), timestamp: z.string().max(100).nullable(), truncated: z.boolean(),
})
const identitySchema = z.object({ url: z.string().max(4096), title: z.string().max(300) })
const snapshotSchema = z.object({ source: z.literal('chatgpt-web'), url: z.string().max(4096).nullable(),
  title: z.string().max(300), revision: z.number().int().nonnegative(),
  phase: z.enum(['disconnected', 'loading', 'login-required', 'ready', 'unavailable']),
  sourceOrder: z.array(z.string().min(1).max(512)).max(100).optional(),
  messages: z.array(messageSchema).max(100), canSend: z.boolean(), draftPresent: z.boolean(),
  siteStatus: z.string().max(2000).nullable(), limited: z.boolean(), errorCode: z.enum(['page-unavailable', 'unsupported-page']).optional(),
}).transform(({ errorCode, sourceOrder, ...snapshot }): DotSnapshot => ({ ...snapshot,
  ...sourceOrder === undefined ? {} : { sourceOrder }, ...errorCode === undefined ? {} : { errorCode },
}))
const sendSchema = z.object({ status: z.enum(['confirmed', 'unknown', 'refused']), snapshot: snapshotSchema,
  messageId: z.string().max(512).optional(),
})
const historySchema = z.object({ messages: z.array(messageSchema).max(100),
  sourceOrder: z.array(z.string().min(1).max(512)).max(100).optional(),
  hasMore: z.boolean(), status: z.enum(['ready', 'unavailable']),
}).transform(({ sourceOrder, ...page }): DotHistoryPage => ({ ...page, ...sourceOrder === undefined ? {} : { sourceOrder } }))

const modeSchema = z.enum(['browser', 'embedded'])
const path = z.string().max(4096)
const setupSchema = z.object({
  protocolVersion: z.literal(1).optional(), available: z.boolean(), extensionDirectory: path,
  registrationScript: path, nativeHostScript: path, nodeExecutable: path, hostName: path, extensionId: path,
  permissions: z.tuple([z.literal('activeTab'), z.literal('scripting'), z.literal('nativeMessaging')]),
})

/**
 * Detect and validate the optional desktop Dot connection operations.
 * @returns Validated preload operations, or undefined in ordinary Web and older desktop clients.
 */
export function desktopAxiomCompanion(): DesktopAxiomCompanion | undefined {
  const bridge = (globalThis as typeof globalThis & {
    dshDesktop?: {
      protocolVersion: number
      axiom?: {
        preferences?: () => Promise<unknown>
        setPreferences?: (preferences: DotPreferences) => Promise<unknown>
        choose?: (hintUrl: string | null) => Promise<unknown>
        subscribe?: (listener: (snapshot: unknown) => void) => () => void
        selection?: () => Promise<unknown>
        snapshot?: () => Promise<unknown>
        send?: (request: DotSendRequest) => Promise<unknown>
        historyBefore?: (beforeId: string) => Promise<unknown>
        showLogin?: () => Promise<unknown>
        transport?: () => Promise<unknown>
        selectTransport?: (mode: AxiomTransportMode) => Promise<unknown>
        browserSetup?: () => Promise<unknown>
      }
    }
  }).dshDesktop
  const axiom = bridge?.protocolVersion === 1 ? bridge.axiom : undefined
  const preferences = axiom?.preferences
  const setPreferences = axiom?.setPreferences
  const choose = axiom?.choose
  const subscribe = axiom?.subscribe
  const selection = axiom?.selection
  const snapshot = axiom?.snapshot
  const send = axiom?.send
  const historyBefore = axiom?.historyBefore
  const showLogin = axiom?.showLogin
  const transport = axiom?.transport
  const selectTransport = axiom?.selectTransport
  const browserSetup = axiom?.browserSetup
  if (typeof preferences !== 'function' || typeof setPreferences !== 'function' || typeof choose !== 'function' || typeof subscribe !== 'function') return undefined
  if (typeof snapshot !== 'function' || typeof send !== 'function' || typeof showLogin !== 'function') return undefined
  if (typeof transport !== 'function' || typeof selectTransport !== 'function' || typeof browserSetup !== 'function') return undefined
  return {
    preferences: async () => preferencesSchema.parse(await preferences()),
    setPreferences: async (value) => { await setPreferences(preferencesSchema.parse(value)) },
    choose: async hintUrl => snapshotSchema.parse(await choose(hintUrl)),
    subscribe: listener => subscribe((snapshot) => { listener(snapshotSchema.parse(snapshot)) }),
    selection: async () => typeof selection === 'function' ? identitySchema.nullable().parse(await selection()) : null,
    snapshot: async () => snapshotSchema.parse(await snapshot()),
    send: async request => sendSchema.parse(await send(request)),
    historyBefore: async beforeId => typeof historyBefore === 'function'
      ? historySchema.parse(await historyBefore(beforeId)) : { messages: [], hasMore: true, status: 'unavailable' },
    showLogin: async () => { await showLogin() },
    transport: async () => modeSchema.parse(await transport()),
    selectTransport: async (mode) => { await selectTransport(modeSchema.parse(mode)) },
    browserSetup: async () => setupSchema.parse(await browserSetup()),
  }
}
