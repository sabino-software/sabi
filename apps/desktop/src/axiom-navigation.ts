/** Exact original-page selection and the dedicated browser's authentication destinations. */

/**
 * Accept only a directly selected original ChatGPT Dot conversation, without URL decorations.
 * @param value Renderer-supplied saved selection.
 * @returns Canonical URL containing no authentication or query material.
 */
export function axiomConversationUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Axiom requires a ChatGPT Dot conversation URL')
  const url = new URL(value)
  if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.search || url.hash
    || !/^\/dots\/[a-zA-Z0-9_~-]+\/?$/u.test(url.pathname)) {
    throw new Error('Axiom requires a ChatGPT Dot conversation URL')
  }
  return url.href.replace(/\/$/u, '')
}

// Official authorization endpoints: developers.google.com/identity/openid-connect/reference,
// developer.apple.com/documentation/signinwithapplerestapi, and learn.microsoft.com/entra/identity-platform.
const IDENTITY_ORIGINS = new Set([
  'https://accounts.google.com', 'https://appleid.apple.com',
  'https://login.microsoftonline.com', 'https://login.live.com',
])

/** Page category used for native navigation admission; auth query contents are never exported. */
export type AxiomNavigation = 'conversation' | 'authentication' | 'return' | 'blocked'

/**
 * Admit the selected Dot, OpenAI's documented auth issuer, and ChatGPT's own auth callbacks.
 * The ChatGPT landing page is admitted only as a return from an observed authentication flow.
 * @param value Original website's requested destination.
 * @param selected Canonical conversation chosen by the user.
 * @param authenticating Whether this page has entered an approved authentication route.
 * @param revealedAuthentication Whether the owned window is visible after explicit login revelation.
 * @returns Navigation category; unrelated conversations, origins and browser schemes are blocked.
 */
export function axiomNavigation(
  value: string, selected: string, authenticating: boolean, revealedAuthentication = false,
): AxiomNavigation {
  let url: URL
  try { url = new URL(value) } catch (_invalidDestination) { return 'blocked' }
  if (url.protocol !== 'https:' || url.username || url.password) return 'blocked'
  // Official auth issuer: https://developers.openai.com/siwc/website
  if (url.origin === 'https://auth.openai.com') return 'authentication'
  if (authenticating && revealedAuthentication && IDENTITY_ORIGINS.has(url.origin)) return 'authentication'
  if (url.origin !== 'https://chatgpt.com') return 'blocked'
  try { if (axiomConversationUrl(value) === selected) return 'conversation' } catch (_notSelectedConversation) { /* Only auth routes remain eligible. */ }
  if (/^\/(?:auth(?:\/|$)|api\/auth(?:\/|$))/u.test(url.pathname)) return 'authentication'
  if (url.pathname === '/' && authenticating) return 'return'
  return 'blocked'
}
