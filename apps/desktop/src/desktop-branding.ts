/** Pure shell branding shared with sandboxed preloads. */
import type { DesktopLocale } from './locale.ts'

/** Explicitly supported local public names; the runtime identity stays independent. */
export type LocalProductName = 'Skeinlet' | 'Sabi'

/**
 * Admit only known public fork names in the sandboxed welcome bootstrap.
 * @param value Untrusted manifest or process argument value.
 * @returns Whether the value names a supported local product.
 */
export function isLocalProductName(value: unknown): value is LocalProductName {
  return value === 'Skeinlet' || value === 'Sabi'
}

/**
 * Substitute the packaged product name in locale-owned native copy.
 * @param locale Resolved shell dictionary.
 * @param productName Packaged application name; the upstream name preserves the original dictionary.
 * @returns Locale copy with the local product name, without modifying shared dictionaries.
 */
export function brandDesktopLocale(locale: DesktopLocale, productName: string): DesktopLocale {
  if (productName === 'DeepSeek Harness') return locale
  const messages = { ...locale.messages }
  for (const key of Object.keys(messages) as (keyof typeof messages)[]) {
    messages[key] = messages[key].replaceAll('DeepSeek Harness', productName)
    if (isLocalProductName(productName) && key.startsWith('cliCommand')) messages[key] = messages[key].replaceAll('dsh', 'sabi')
  }
  if (isLocalProductName(productName)) {
    const copy: readonly [string, string] = locale.id === 'pt'
      ? ['Abrir espaço de trabalho', 'Seu espaço de programação. Configure o Codex em Configurações → Modelos.']
      : locale.id === 'zh-CN'
        ? ['打开工作区', '你的编程工作区。在“设置 → 模型”中配置 Codex。']
        : ['Open workspace', 'Your coding workspace. Set up Codex in Settings → Models.']
    messages.welcomeSignIn = copy[0]
    messages.welcomeDescription = copy[1]
  }
  return { ...locale, messages }
}
