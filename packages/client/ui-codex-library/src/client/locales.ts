/** Locale-owned native conversation connection and source labels. */
export const en = {
  dot: 'Dot', dotEnabled: 'Enable Dot integration', dotShowInSidebar: 'Show Dot in sidebar',
  dotPreferencesError: 'Could not save or read Dot options. Try again.',
  dotSelectionPending: 'Sign in to ChatGPT and select your Dot in the ChatGPT window. It will open here when ready.',
  dotSelectionError: 'Could not open the selected Dot. Check ChatGPT and select Dot again.',
  codexSelect: 'Use work Codex for new chats',
  codexSelecting: 'Selecting work Codex…',
  codexSelected: 'Using work Codex for new chats.',
  codexSelectError: 'Could not select work Codex. Check its connection and try again.',

  axiomTransport: 'Axiom sign-in connection', axiomTransportEmbedded: 'Sign in inside the app', axiomTransportBrowser: 'Use regular browser',
  axiomTransportLoading: 'Reading or changing the connection…',
  axiomTransportError: 'Could not confirm the Axiom connection. Finish any active send, then refresh and try again.',
  axiomBrowserPrivacy: 'The companion reads rendered messages and sends your exact text in one selected Dot tab. Cookies and sign-in stay in your browser.',
  axiomBrowserUnavailable: 'The browser companion is unavailable in this build. Choose app sign-in or use a build that includes the companion.',
  axiomBrowserSetup: 'Set up the browser companion',
  axiomBrowserInstall: 'One-time manual setup: load the extension folder in your intended work Chrome or Edge profile. Review the registration script and its output before registering the native messaging host. This panel does not install anything.',
  axiomBrowserPair: 'After signing in, open the selected Dot, click the extension toolbar button, and approve the native pairing prompt. Click again after reloading the tab or completing a new login.',
  axiomExtensionDirectory: 'Extension folder', axiomRegistrationScript: 'Registration script', axiomNativeHost: 'Native host script',
  axiomNodeExecutable: 'Bundled Node executable', axiomHostName: 'Native host name', axiomExtensionId: 'Extension ID',
  axiomBrowserPermissions: 'Requested extension permissions',

  codexSignedIn: 'Work Codex is signed in.', codexSignedOut: 'Work Codex is not signed in with ChatGPT.', codexLogin: 'Sign in to work Codex',
  codexLoginBrowser: 'Continue in browser', codexLoginCancel: 'Cancel Codex sign-in',
  codexLoginPending: 'Finish sign-in in your browser, or cancel this attempt to start again.',
  codexLoginVerifying: 'Confirming the signed-in Codex account…', codexLoginSucceeded: 'Codex sign-in confirmed.',
  codexLoginCancelled: 'Codex sign-in cancelled.', codexLoginError: 'Codex sign-in could not be started. Check the work Codex app.',
  codexLoginBoundary: 'Codex sign-in does not sign in to the ChatGPT website used by Axiom.',

  title: 'Native conversations', subtitle: 'Continue existing conversations from the workspace sidebar.',
  refresh: 'Refresh', loading: 'Reading connection status…', statusError: 'Connection status could not be loaded. Refresh to try again.',
  actionError: 'The operation failed. Check the connection and try again.',
  codex: 'Codex', codexDescription: 'Sync existing work Codex threads into their workspaces. Open a conversation there to continue it.',
  connected: 'Connected', disconnected: 'Not connected', sync: 'Sync Codex conversations', syncing: 'Syncing…', synced: 'Imported {count} conversations.',
  axiom: 'Axiom', axiomDescription: 'Connect your original ChatGPT Dot. Continue its conversation in the normal chat and sign in through ChatGPT when needed.',
  bridgeAvailable: 'Desktop bridge available', bridgeUnavailable: 'Desktop bridge unavailable',
  url: 'Existing ChatGPT Dot URL', connect: 'Connect Axiom', connecting: 'Connecting…', login: 'Open ChatGPT login', openingLogin: 'Opening login…',
  openOriginal: 'Open ChatGPT', openingOriginal: 'Opening ChatGPT…', openOriginalError: 'Could not open ChatGPT. Try again.',
  sourceCodex: 'Codex', sourceAxiom: 'Axiom', sourceCodexHint: 'Continues the original Codex thread.', sourceAxiomHint: 'Continues the original Axiom conversation through ChatGPT.',
} as const

/** Native conversation dictionary keys. */
export type CodexLibraryKey = keyof typeof en

/** Simplified Chinese copy. */
export const zh: Record<CodexLibraryKey, string> = {
  dot: 'Dot', dotEnabled: '启用 Dot 集成', dotShowInSidebar: '在侧边栏显示 Dot',
  dotPreferencesError: '无法保存或读取 Dot 选项，请重试。',
  dotSelectionPending: '请在 ChatGPT 窗口登录并选择 Dot。准备就绪后将在此打开。',
  dotSelectionError: '无法打开所选 Dot，请检查 ChatGPT 并重新选择 Dot。',
  codexSelect: '新聊天使用工作 Codex',
  codexSelecting: '正在选择工作 Codex…',
  codexSelected: '新聊天使用工作 Codex。',
  codexSelectError: '无法选择工作 Codex。请检查连接并重试。',

  axiomTransport: 'Axiom 登录连接', axiomTransportEmbedded: '在应用内登录', axiomTransportBrowser: '使用常规浏览器',
  axiomTransportLoading: '正在读取或更改连接…',
  axiomTransportError: '无法确认 Axiom 连接。请等待当前发送结束，再刷新并重试。',
  axiomBrowserPrivacy: '伴随扩展仅在选定的 Dot 标签页读取已渲染消息并发送用户输入的原文。Cookie 和登录保留在浏览器中。',
  axiomBrowserUnavailable: '此构建不提供浏览器伴随扩展。请选择应用内登录，或使用包含扩展的构建。',
  axiomBrowserSetup: '设置浏览器伴随扩展',
  axiomBrowserInstall: '一次性手动设置：在所需的工作 Chrome 或 Edge 配置中加载扩展文件夹。注册原生消息主机前，请检查注册脚本及其输出。本面板不执行任何安装。',
  axiomBrowserPair: '登录后打开指定 Dot，点击扩展工具栏按钮，并批准原生配对提示。重新加载标签页或完成新的登录后，请再次点击按钮。',
  axiomExtensionDirectory: '扩展文件夹', axiomRegistrationScript: '注册脚本', axiomNativeHost: '原生主机脚本',
  axiomNodeExecutable: '随附的 Node 可执行文件', axiomHostName: '原生主机名称', axiomExtensionId: '扩展 ID',
  axiomBrowserPermissions: '请求的扩展权限',

  codexSignedIn: '工作 Codex 已登录。', codexSignedOut: '工作 Codex 未通过 ChatGPT 登录。', codexLogin: '登录工作 Codex',
  codexLoginBrowser: '在浏览器中继续', codexLoginCancel: '取消 Codex 登录',
  codexLoginPending: '请在浏览器中完成登录，或取消此尝试后重新开始。',
  codexLoginVerifying: '正在确认已登录的 Codex 账户…', codexLoginSucceeded: '已确认 Codex 登录。',
  codexLoginCancelled: '已取消 Codex 登录。', codexLoginError: '无法开始 Codex 登录，请检查工作 Codex 应用。',
  codexLoginBoundary: 'Codex 登录不会登录 Axiom 使用的 ChatGPT 网站。',

  title: '原生对话', subtitle: '从工作区侧边栏继续现有对话。', refresh: '刷新', loading: '正在读取连接状态…', statusError: '无法读取连接状态，请刷新重试。', actionError: '操作失败，请检查连接后重试。',
  codex: 'Codex', codexDescription: '将现有工作 Codex 对话同步到对应工作区，打开对话即可继续。', connected: '已连接', disconnected: '未连接', sync: '同步 Codex 对话', syncing: '正在同步…', synced: '已导入 {count} 个对话。',
  axiom: 'Axiom', axiomDescription: '连接原始 ChatGPT Dot，在常规聊天界面继续对话，并在需要时通过 ChatGPT 登录。', bridgeAvailable: '桌面桥接可用', bridgeUnavailable: '桌面桥接不可用', url: '现有 ChatGPT Dot 网址', connect: '连接 Axiom', connecting: '正在连接…', login: '打开 ChatGPT 登录', openingLogin: '正在打开登录…',
  openOriginal: '打开 ChatGPT', openingOriginal: '正在打开 ChatGPT…', openOriginalError: '无法打开 ChatGPT，请重试。',
  sourceCodex: 'Codex', sourceAxiom: 'Axiom', sourceCodexHint: '继续原始 Codex 对话。', sourceAxiomHint: '通过 ChatGPT 继续原始 Axiom 对话。',
}

/** Brazilian Portuguese copy. */
export const pt: Record<CodexLibraryKey, string> = {
  dot: 'Dot', dotEnabled: 'Ativar integração Dot', dotShowInSidebar: 'Mostrar Dot na barra lateral',
  dotPreferencesError: 'Não foi possível salvar ou ler as opções do Dot. Tente novamente.',
  dotSelectionPending: 'Entre no ChatGPT e selecione seu Dot na janela do ChatGPT. Ele será aberto aqui quando estiver pronto.',
  dotSelectionError: 'Não foi possível abrir o Dot selecionado. Verifique o ChatGPT e selecione o Dot novamente.',
  codexSelect: 'Usar Codex de trabalho em novas conversas',
  codexSelecting: 'Selecionando Codex de trabalho…',
  codexSelected: 'Usando Codex de trabalho em novas conversas.',
  codexSelectError: 'Não foi possível selecionar o Codex de trabalho. Verifique a conexão e tente novamente.',

  axiomTransport: 'Conexão de entrada da Axiom', axiomTransportEmbedded: 'Entrar dentro do aplicativo', axiomTransportBrowser: 'Usar navegador habitual',
  axiomTransportLoading: 'Lendo ou alterando a conexão…',
  axiomTransportError: 'Não foi possível confirmar a conexão da Axiom. Aguarde o envio ativo, atualize e tente novamente.',
  axiomBrowserPrivacy: 'A extensão lê mensagens renderizadas e envia seu texto exato em uma aba Dot selecionada. Cookies e login ficam no navegador.',
  axiomBrowserUnavailable: 'Esta versão não inclui a extensão do navegador. Escolha a entrada no aplicativo ou uma versão que inclua a extensão.',
  axiomBrowserSetup: 'Configurar a extensão do navegador',
  axiomBrowserInstall: 'Configuração manual única: carregue a pasta da extensão no perfil de trabalho desejado do Chrome ou Edge. Revise o script de registro e sua saída antes de registrar o host de mensagens nativas. Este painel não instala nada.',
  axiomBrowserPair: 'Após entrar, abra a Dot selecionada, clique no botão da extensão e aprove a confirmação nativa. Clique novamente após recarregar a aba ou concluir um novo login.',
  axiomExtensionDirectory: 'Pasta da extensão', axiomRegistrationScript: 'Script de registro', axiomNativeHost: 'Script do host nativo',
  axiomNodeExecutable: 'Executável Node incluído', axiomHostName: 'Nome do host nativo', axiomExtensionId: 'ID da extensão',
  axiomBrowserPermissions: 'Permissões solicitadas pela extensão',

  codexSignedIn: 'O Codex de trabalho está conectado.', codexSignedOut: 'O Codex de trabalho não está conectado com o ChatGPT.', codexLogin: 'Entrar no Codex de trabalho',
  codexLoginBrowser: 'Continuar no navegador', codexLoginCancel: 'Cancelar entrada no Codex',
  codexLoginPending: 'Conclua a entrada no navegador ou cancele esta tentativa para recomeçar.',
  codexLoginVerifying: 'Confirmando a conta conectada do Codex…', codexLoginSucceeded: 'Entrada no Codex confirmada.',
  codexLoginCancelled: 'Entrada no Codex cancelada.', codexLoginError: 'Não foi possível iniciar a entrada. Verifique o aplicativo Codex de trabalho.',
  codexLoginBoundary: 'A entrada no Codex não conecta o site ChatGPT usado pela Axiom.',

  title: 'Conversas nativas', subtitle: 'Continue conversas existentes pela barra lateral dos espaços de trabalho.', refresh: 'Atualizar', loading: 'Lendo o status das conexões…', statusError: 'Não foi possível ler o status. Atualize para tentar novamente.', actionError: 'A operação falhou. Verifique a conexão e tente novamente.',
  codex: 'Codex', codexDescription: 'Sincronize as conversas existentes do Codex de trabalho com seus espaços. Abra uma conversa ali para continuar.', connected: 'Conectado', disconnected: 'Desconectado', sync: 'Sincronizar conversas do Codex', syncing: 'Sincronizando…', synced: '{count} conversas importadas.',
  axiom: 'Axiom', axiomDescription: 'Conecte sua Dot original do ChatGPT. Continue a conversa no chat normal e entre pelo ChatGPT quando necessário.', bridgeAvailable: 'Ponte do Desktop disponível', bridgeUnavailable: 'Ponte do Desktop indisponível', url: 'URL da Dot existente no ChatGPT', connect: 'Conectar Axiom', connecting: 'Conectando…', login: 'Abrir login do ChatGPT', openingLogin: 'Abrindo login…',
  openOriginal: 'Abrir ChatGPT', openingOriginal: 'Abrindo ChatGPT…', openOriginalError: 'Não foi possível abrir o ChatGPT. Tente novamente.',
  sourceCodex: 'Codex', sourceAxiom: 'Axiom', sourceCodexHint: 'Continua a conversa original do Codex.', sourceAxiomHint: 'Continua a conversa original da Axiom pelo ChatGPT.',
}
