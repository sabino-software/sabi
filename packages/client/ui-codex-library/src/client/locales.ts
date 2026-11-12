/** Locale-owned native conversation connection and source labels. */
export const en = {
  title: 'Native conversations', subtitle: 'Continue existing conversations from the workspace sidebar.',
  refresh: 'Refresh', loading: 'Reading connection status…', statusError: 'Connection status could not be loaded. Refresh to try again.',
  actionError: 'The operation failed. Check the connection and try again.',
  codex: 'Codex', codexDescription: 'Sync existing work Codex threads into their workspaces. Open a conversation there to continue it.',
  connected: 'Connected', disconnected: 'Not connected', sync: 'Sync Codex conversations', syncing: 'Syncing…', synced: 'Imported {count} conversations.',
  axiom: 'Axiom', axiomDescription: 'Connect your original ChatGPT Dot. Continue its conversation in the normal chat and sign in through ChatGPT when needed.',
  bridgeAvailable: 'Desktop bridge available', bridgeUnavailable: 'Desktop bridge unavailable',
  url: 'Existing ChatGPT Dot URL', connect: 'Connect Axiom', connecting: 'Connecting…', login: 'Open ChatGPT login', openingLogin: 'Opening login…',
  sourceCodex: 'Codex', sourceAxiom: 'Axiom', sourceCodexHint: 'Continues the original Codex thread.', sourceAxiomHint: 'Continues the original Axiom conversation through ChatGPT.',
} as const

/** Native conversation dictionary keys. */
export type CodexLibraryKey = keyof typeof en

/** Simplified Chinese copy. */
export const zh: Record<CodexLibraryKey, string> = {
  title: '原生对话', subtitle: '从工作区侧边栏继续现有对话。', refresh: '刷新', loading: '正在读取连接状态…', statusError: '无法读取连接状态，请刷新重试。', actionError: '操作失败，请检查连接后重试。',
  codex: 'Codex', codexDescription: '将现有工作 Codex 对话同步到对应工作区，打开对话即可继续。', connected: '已连接', disconnected: '未连接', sync: '同步 Codex 对话', syncing: '正在同步…', synced: '已导入 {count} 个对话。',
  axiom: 'Axiom', axiomDescription: '连接原始 ChatGPT Dot，在常规聊天界面继续对话，并在需要时通过 ChatGPT 登录。', bridgeAvailable: '桌面桥接可用', bridgeUnavailable: '桌面桥接不可用', url: '现有 ChatGPT Dot 网址', connect: '连接 Axiom', connecting: '正在连接…', login: '打开 ChatGPT 登录', openingLogin: '正在打开登录…',
  sourceCodex: 'Codex', sourceAxiom: 'Axiom', sourceCodexHint: '继续原始 Codex 对话。', sourceAxiomHint: '通过 ChatGPT 继续原始 Axiom 对话。',
}

/** Brazilian Portuguese copy. */
export const pt: Record<CodexLibraryKey, string> = {
  title: 'Conversas nativas', subtitle: 'Continue conversas existentes pela barra lateral dos espaços de trabalho.', refresh: 'Atualizar', loading: 'Lendo o status das conexões…', statusError: 'Não foi possível ler o status. Atualize para tentar novamente.', actionError: 'A operação falhou. Verifique a conexão e tente novamente.',
  codex: 'Codex', codexDescription: 'Sincronize as conversas existentes do Codex de trabalho com seus espaços. Abra uma conversa ali para continuar.', connected: 'Conectado', disconnected: 'Desconectado', sync: 'Sincronizar conversas do Codex', syncing: 'Sincronizando…', synced: '{count} conversas importadas.',
  axiom: 'Axiom', axiomDescription: 'Conecte sua Dot original do ChatGPT. Continue a conversa no chat normal e entre pelo ChatGPT quando necessário.', bridgeAvailable: 'Ponte do Desktop disponível', bridgeUnavailable: 'Ponte do Desktop indisponível', url: 'URL da Dot existente no ChatGPT', connect: 'Conectar Axiom', connecting: 'Conectando…', login: 'Abrir login do ChatGPT', openingLogin: 'Abrindo login…',
  sourceCodex: 'Codex', sourceAxiom: 'Axiom', sourceCodexHint: 'Continua a conversa original do Codex.', sourceAxiomHint: 'Continua a conversa original da Axiom pelo ChatGPT.',
}
