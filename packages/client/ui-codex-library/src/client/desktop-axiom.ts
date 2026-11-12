/** Structural desktop capability detection; this Client never imports the Electron application. */
import { z } from 'zod'

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

/** Optional owner-window operations; changing mode is always an explicit user action. */
export interface DesktopAxiomCompanion {
  readonly transport: () => Promise<AxiomTransportMode>
  readonly selectTransport: (mode: AxiomTransportMode) => Promise<void>
  readonly browserSetup: () => Promise<AxiomBrowserSetup>
}

const modeSchema = z.enum(['browser', 'embedded'])
const path = z.string().max(4096)
const setupSchema = z.object({
  protocolVersion: z.literal(1).optional(), available: z.boolean(), extensionDirectory: path,
  registrationScript: path, nativeHostScript: path, nodeExecutable: path, hostName: path, extensionId: path,
  permissions: z.tuple([z.literal('activeTab'), z.literal('scripting'), z.literal('nativeMessaging')]),
})

/** @returns Validated optional preload operations, or undefined in ordinary Web and older desktop clients. */
export function desktopAxiomCompanion(): DesktopAxiomCompanion | undefined {
  const bridge = (globalThis as typeof globalThis & {
    dshDesktop?: {
      protocolVersion: number
      axiom?: {
        transport?: () => Promise<unknown>
        selectTransport?: (mode: AxiomTransportMode) => Promise<unknown>
        browserSetup?: () => Promise<unknown>
      }
    }
  }).dshDesktop
  const axiom = bridge?.protocolVersion === 1 ? bridge.axiom : undefined
  const transport = axiom?.transport
  const selectTransport = axiom?.selectTransport
  const browserSetup = axiom?.browserSetup
  if (typeof transport !== 'function' || typeof selectTransport !== 'function' || typeof browserSetup !== 'function') return undefined
  return {
    transport: async () => modeSchema.parse(await transport()),
    selectTransport: async (mode) => { await selectTransport(modeSchema.parse(mode)) },
    browserSetup: async () => setupSchema.parse(await browserSetup()),
  }
}
