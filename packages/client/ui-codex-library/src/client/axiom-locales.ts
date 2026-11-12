/** Source-message chrome has no completion or model-generation claims. */
export const en = {
  copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes', codeLabel: 'Code', wrap: 'Wrap lines', unwrap: 'Unwrap lines',
  sourceTruncated: 'The original message exceeds the visible source window. Open ChatGPT to read the rest.',
} as const
/** Source-message dictionary keys. */
export type AxiomMessageKey = keyof typeof en
/** Simplified Chinese source-message copy. */
export const zh: Record<AxiomMessageKey, string> = {
  copy: '复制', copied: '已复制', footnotes: '脚注', codeLabel: '代码', wrap: '自动换行', unwrap: '取消自动换行',
  sourceTruncated: '原始消息超出可见来源窗口，请打开 ChatGPT 阅读其余内容。',
}
/** Brazilian Portuguese source-message copy. */
export const pt: Record<AxiomMessageKey, string> = {
  copy: 'Copiar', copied: 'Copiado', footnotes: 'Notas de rodapé', codeLabel: 'Código', wrap: 'Quebrar linhas', unwrap: 'Não quebrar linhas',
  sourceTruncated: 'A mensagem original excede a janela visível da fonte. Abra o ChatGPT para ler o restante.',
}
