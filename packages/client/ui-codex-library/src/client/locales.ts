/** Locale-owned copy for the source chat library. */
export const en = {
  title: 'Codex chats', subtitle: 'Your existing work conversations', readOnly: 'Read-only source',
  source: 'Source', search: 'Search titles', searchAction: 'Search', refresh: 'Refresh',
  active: 'Active', archived: 'Archived', archiveFilter: 'Chat status',
  empty: 'No chats match this search.', select: 'Choose a chat to read its history.',
  loading: 'Loading chats…', loadingTranscript: 'Loading transcript…',
  error: 'Chats could not be loaded. Check the work Codex source and try again.',
  transcriptError: 'This transcript is unavailable. Refresh to try again.',
  next: 'Next chats', first: 'First page', older: 'Older messages', latest: 'Latest messages',
  user: 'You', assistant: 'Assistant', copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes',
  textOnly: 'Visible user and assistant text. Tools, reasoning, and attachments are omitted.',
  limited: 'Some oversized messages were omitted from this page.',
  noMessages: 'No visible text is available on this page.', back: 'All chats',
} as const

/** Source dictionary keys. */
export type CodexLibraryKey = keyof typeof en

/** Simplified Chinese copy. */
export const zh: Record<CodexLibraryKey, string> = {
  title: 'Codex 对话', subtitle: '已有的工作对话', readOnly: '只读来源',
  source: '来源', search: '搜索标题', searchAction: '搜索', refresh: '刷新',
  active: '当前', archived: '已归档', archiveFilter: '对话状态', empty: '没有匹配的对话',
  select: '选择对话以查看历史记录', loading: '正在读取对话…', loadingTranscript: '正在读取记录…',
  error: '无法读取对话，请检查工作 Codex 来源后重试', transcriptError: '无法读取此记录，请刷新后重试',
  next: '下一页对话', first: '首页', older: '更早的消息', latest: '最新消息',
  user: '你', assistant: '助手', copy: '复制', copied: '已复制', footnotes: '脚注',
  textOnly: '仅显示用户和助手的文字，省略工具、推理和附件', limited: '此页省略了部分过长的消息',
  noMessages: '此页没有可显示的文字', back: '所有对话',
}

/** Brazilian Portuguese copy. */
export const pt: Record<CodexLibraryKey, string> = {
  title: 'Conversas do Codex', subtitle: 'Suas conversas de trabalho existentes', readOnly: 'Fonte somente leitura',
  source: 'Fonte', search: 'Buscar títulos', searchAction: 'Buscar', refresh: 'Atualizar',
  active: 'Ativas', archived: 'Arquivadas', archiveFilter: 'Status da conversa', empty: 'Nenhuma conversa encontrada.',
  select: 'Escolha uma conversa para ler o histórico.', loading: 'Carregando conversas…', loadingTranscript: 'Carregando histórico…',
  error: 'Não foi possível carregar as conversas. Verifique a fonte do Codex de trabalho e tente novamente.',
  transcriptError: 'Este histórico está indisponível. Atualize para tentar novamente.',
  next: 'Próximas conversas', first: 'Primeira página', older: 'Mensagens anteriores', latest: 'Mensagens recentes',
  user: 'Você', assistant: 'Assistente', copy: 'Copiar', copied: 'Copiado', footnotes: 'Notas de rodapé',
  textOnly: 'Texto visível do usuário e do assistente. Ferramentas, raciocínio e anexos são omitidos.',
  limited: 'Algumas mensagens muito grandes foram omitidas desta página.', noMessages: 'Não há texto visível nesta página.', back: 'Todas as conversas',
}
