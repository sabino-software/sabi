/** Copy for source-engine activity; completed means finished, without asserting success. */
export const en = { source: 'Codex', started: 'In progress', completed: 'Finished', copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes' } as const
/** Keys shared by the source activity dictionaries. */
export type CodexActivityKey = keyof typeof en
type Dictionary = Record<CodexActivityKey, string>
/** Simplified Chinese source activity copy. */
export const zh: Dictionary = { source: 'Codex', started: '进行中', completed: '已结束', copy: '复制', copied: '已复制', footnotes: '脚注' }
/** Japanese source activity copy. */
export const ja: Dictionary = { source: 'Codex', started: '実行中', completed: '終了', copy: 'コピー', copied: 'コピー済み', footnotes: '脚注' }
/** Spanish source activity copy. */
export const es: Dictionary = { source: 'Codex', started: 'En curso', completed: 'Finalizado', copy: 'Copiar', copied: 'Copiado', footnotes: 'Notas al pie' }
/** French source activity copy. */
export const fr: Dictionary = { source: 'Codex', started: 'En cours', completed: 'Terminé', copy: 'Copier', copied: 'Copié', footnotes: 'Notes de bas de page' }
/** German source activity copy. */
export const de: Dictionary = { source: 'Codex', started: 'In Bearbeitung', completed: 'Beendet', copy: 'Kopieren', copied: 'Kopiert', footnotes: 'Fußnoten' }
/** Russian source activity copy. */
export const ru: Dictionary = { source: 'Codex', started: 'Выполняется', completed: 'Завершено', copy: 'Копировать', copied: 'Скопировано', footnotes: 'Сноски' }
/** Portuguese source activity copy. */
export const pt: Dictionary = { source: 'Codex', started: 'Em andamento', completed: 'Finalizado', copy: 'Copiar', copied: 'Copiado', footnotes: 'Notas de rodapé' }
