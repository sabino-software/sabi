/** Environment removals preserve the shared credential policy across OAR's overlay API. */

import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

/**
 * Translate the shared scrub into OAR's inherited-environment overlay.
 * @param extra - explicit deployment entries; null removes an inherited value.
 * @returns only scrub removals, changed proxy values, and explicit settings, preserving native removals.
 */
export function oarEnvironment(extra: Readonly<Record<string, string | null>>): Record<string, string | null> {
  const scrubbed = scrubbedParentEnv()
  const overlay: Record<string, string | null> = {}
  for (const key of Object.keys(process.env)) {
    if (!Object.hasOwn(scrubbed, key)) overlay[key] = null
  }
  for (const [key, value] of Object.entries(scrubbed)) {
    if (process.env[key] !== value) overlay[key] = value
  }
  return {
    ...overlay, ...extra,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_ENABLE_TELEMETRY: '0',
    OTEL_SDK_DISABLED: 'true',
    DO_NOT_TRACK: '1',
  }
}
