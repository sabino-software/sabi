/** Native pairing copy for the explicitly selected original ChatGPT browser document. */
const en = {
  title: 'Connect original ChatGPT conversation',
  message: 'Allow this browser tab to share its conversation with Skeinlet?',
  detail: 'Only this selected Dot is connected. Website sign-in stays in your browser.',
  connect: 'Connect this conversation', cancel: 'Cancel',
  pairingNotice: 'Open this Dot in your regular browser, then click the Skeinlet extension to connect it.',
}
const zh: typeof en = {
  title: '连接原始 ChatGPT 对话', message: '允许该浏览器标签页与 Skeinlet 共享此对话吗？',
  detail: '仅连接此指定 Dot。网站登录始终由浏览器管理。', connect: '连接此对话', cancel: '取消',
  pairingNotice: '在常用浏览器中打开此 Dot，然后点击 Skeinlet 扩展进行连接。',
}
const pt: typeof en = {
  title: 'Conectar conversa original do ChatGPT', message: 'Permitir que esta aba compartilhe a conversa com o Skeinlet?',
  detail: 'Somente esta Dot será conectada. O login do site permanece no navegador.', connect: 'Conectar esta conversa', cancel: 'Cancelar',
  pairingNotice: 'Abra esta Dot no navegador habitual e clique na extensão do Skeinlet para conectá-la.',
}

/** @param locale Desktop locale identifier. @returns Localized pairing consent and connection guidance, with English fallback. */
export function axiomBrowserCopy(locale: string): typeof en {
  return locale.startsWith('zh') ? zh : locale.startsWith('pt') ? pt : en
}
