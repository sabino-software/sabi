/** Correlated requests accepted only from the shell-owned Desktop Host child. */
import { z } from 'zod'
import type { AxiomSendResult, AxiomSnapshot } from './axiom-protocol.ts'

const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
/** Validated child request; arbitrary Electron operations are not expressible. */
export const axiomHostRequestSchema = z.discriminatedUnion('method', [
  z.object({ type: z.literal('axiom-request'), requestId: id, method: z.literal('axiom/connect'), args: z.object({ url: z.string().max(4096) }).strict() }).strict(),
  z.object({ type: z.literal('axiom-request'), requestId: id, method: z.literal('axiom/snapshot'), args: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('axiom-request'), requestId: id, method: z.literal('axiom/send'), args: z.object({ request: z.object({
    requestId: z.string().min(8).max(200).regex(/^[a-zA-Z0-9_-]+$/u), revision: z.number().int().nonnegative(), text: z.string().min(1).max(131072),
  }).strict() }).strict() }).strict(),
  z.object({ type: z.literal('axiom-request'), requestId: id, method: z.literal('axiom/showLogin'), args: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('axiom-request'), requestId: id, method: z.literal('axiom/disconnect'), args: z.object({}).strict() }).strict(),
])
/** Child-owned cancellation affects only its correlated native operation. */
export const axiomHostCancelSchema = z.object({ type: z.literal('axiom-cancel'), requestId: id }).strict()
/** The validated child request passed to the native page owner. */
export type AxiomHostRequest = z.infer<typeof axiomHostRequestSchema>
/** Browser-safe reply value; null acknowledges operations without a projection. */
export type AxiomHostValue = AxiomSnapshot | AxiomSendResult | null
/** Native handler whose signal is aborted when its requesting Host stops. */
export type AxiomHostHandler = (request: AxiomHostRequest, signal: AbortSignal) => Promise<AxiomHostValue>
