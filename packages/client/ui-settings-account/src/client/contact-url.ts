/** Remove legacy hidden diagnostics from configured contact links. */
import type { ContactConfig } from '../contact-config.ts'

/**
 * Keep the configured questionnaire destination without hidden context fields.
 * @param config - questionnaire destination.
 * @returns questionnaire URL preserving unrelated parameters and its fragment.
 */
export function contactUrl(config: ContactConfig): string {
  const url = new URL(config.contactFormUrl)
  for (const name of ['uid', 'source', 'harness_version', 'device_info', 'os_version', 'device_brand',
    'app_locale', 'screen_resolution', 'app_version', 'device_model']) {
    url.searchParams.delete(`prefill_${name}`)
    url.searchParams.delete(`hide_${name}`)
  }
  return url.href
}
