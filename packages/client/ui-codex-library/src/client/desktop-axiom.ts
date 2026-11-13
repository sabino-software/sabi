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

/** Minimal observed website state needed for explicit Dot selection. */
export interface DotSelection { readonly url: string | null; readonly phase: 'disconnected' | 'loading' | 'login-required' | 'ready' | 'unavailable' }

/** Optional owner-window operations; changing mode is always an explicit user action. */
export interface DesktopAxiomCompanion {
  readonly preferences: () => Promise<DotPreferences>
  readonly setPreferences: (preferences: DotPreferences) => Promise<void>
  readonly choose: (hintUrl: string | null) => Promise<DotSelection>
  readonly subscribe: (listener: (snapshot: DotSelection) => void) => () => void
  readonly transport: () => Promise<AxiomTransportMode>
  readonly selectTransport: (mode: AxiomTransportMode) => Promise<void>
  readonly browserSetup: () => Promise<AxiomBrowserSetup>
}

const preferencesSchema = z.object({ enabled: z.boolean(), showInSidebar: z.boolean(),
  sidebarStyle: z.enum(['sameNewSession', 'subtle', 'outline']).default('sameNewSession'),
}).strict()
const selectionSchema = z.object({ url: z.string().max(4096).nullable(), phase: z.enum(['disconnected', 'loading', 'login-required', 'ready', 'unavailable']) })

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
  const transport = axiom?.transport
  const selectTransport = axiom?.selectTransport
  const browserSetup = axiom?.browserSetup
  if (typeof preferences !== 'function' || typeof setPreferences !== 'function' || typeof choose !== 'function' || typeof subscribe !== 'function') return undefined
  if (typeof transport !== 'function' || typeof selectTransport !== 'function' || typeof browserSetup !== 'function') return undefined
  return {
    preferences: async () => preferencesSchema.parse(await preferences()),
    setPreferences: async (value) => { await setPreferences(preferencesSchema.parse(value)) },
    choose: async hintUrl => selectionSchema.parse(await choose(hintUrl)),
    subscribe: listener => subscribe((snapshot) => { listener(selectionSchema.parse(snapshot)) }),
    transport: async () => modeSchema.parse(await transport()),
    selectTransport: async (mode) => { await selectTransport(modeSchema.parse(mode)) },
    browserSetup: async () => setupSchema.parse(await browserSetup()),
  }
}
