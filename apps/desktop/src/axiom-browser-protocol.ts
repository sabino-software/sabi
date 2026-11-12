/** The extension can pair one selected Dot and answer fixed original-page operations only. */
import { z } from 'zod'

/** Stable unpacked-extension identity derived from the manifest's public key. */
export const AXIOM_EXTENSION_ID = 'kbmcpehehgohghdkbamffnepndemabkd'
/** Registered browser native messaging host name, independent of upstream DSH. */
export const AXIOM_NATIVE_HOST = 'dev.sabino.skeinlet.axiom'
/** The sole caller origin accepted by the packaged native helper. */
export const AXIOM_EXTENSION_ORIGIN = `chrome-extension://${AXIOM_EXTENSION_ID}/`
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** First app-socket message, added by the native helper and never exposed to webpage scripts. */
export const browserAuthenticationSchema = z.object({ type: z.literal('authenticate'), version: z.literal(1),
  key: z.string().regex(/^[a-f0-9]{64}$/u), origin: z.literal(AXIOM_EXTENSION_ORIGIN) }).strict()
/** User-toolbar-selected main document offered for explicit native confirmation. */
export const browserPairSchema = z.object({ type: z.literal('pair'), version: z.literal(1),
  tabId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), documentId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/u),
  url: z.string().max(4096) }).strict()
/** The bounded selected original conversation state accepted from the browser. */
export const browserSnapshotSchema = z.object({ source: z.literal('chatgpt-web'), url: z.string().max(4096).nullable(),
  title: z.string().max(300), revision: z.number().int().nonnegative(), phase: z.enum(['disconnected', 'loading', 'login-required', 'ready', 'unavailable']),
  messages: z.array(z.object({ id: z.string().min(1).max(512), role: z.enum(['user', 'assistant']), text: z.string().max(32768),
    timestamp: z.string().max(100).nullable(), truncated: z.boolean() }).strict()).max(100),
  canSend: z.boolean(), draftPresent: z.boolean(), siteStatus: z.string().max(500).nullable(), limited: z.boolean(),
  errorCode: z.enum(['page-unavailable', 'unsupported-page']).optional(),
}).strict().refine(value => value.messages.reduce((size, message) => size + message.text.length, 0) <= 131072)
/** Exact explicit user text and its last observed source revision. */
export const browserSendSchema = z.object({ requestId: z.string().min(8).max(200).regex(/^[a-zA-Z0-9_-]+$/u),
  revision: z.number().int().nonnegative(), text: z.string().min(1).max(131072) }).strict()
/** Browser command replies carry no unstructured page exceptions or authentication URLs. */
export const browserResponseSchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('response'), id, pairId: z.string().regex(/^[a-f0-9]{32}$/u), ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ type: z.literal('response'), id, pairId: z.string().regex(/^[a-f0-9]{32}$/u), ok: z.literal(false), code: z.enum(['unavailable', 'invalid-request']) }).strict(),
])
/** Confirmation or uncertainty for exactly one original-site submission. */
export const browserSendResultSchema = z.object({ status: z.enum(['confirmed', 'unknown', 'refused']),
  messageId: z.string().max(512).optional(), snapshot: browserSnapshotSchema }).strict()
/** Selected browser document shown in the native pairing confirmation. */
export type BrowserAxiomPair = z.infer<typeof browserPairSchema>
