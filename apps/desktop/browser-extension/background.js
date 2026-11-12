/** Fixed extension transport. Only a toolbar-selected main document can be paired with the native app. */
const HOST = 'dev.sabino.skeinlet.axiom'
let port
let selected
let paired
let actionGeneration = 0

function canonical(value) {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.search || url.hash
      || !/^\/dots\/[a-zA-Z0-9_~-]+\/?$/.test(url.pathname)) return null
    return url.href.replace(/\/$/, '')
  } catch { return null }
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function keys(value, allowed) { return record(value) && Object.keys(value).every(key => allowed.includes(key)) }
function unavailable(url) {
  return { source: 'chatgpt-web', url, title: '', revision: 0, phase: 'login-required', messages: [], canSend: false,
    draftPresent: false, siteStatus: null, limited: true }
}
function validRequest(value) {
  if (!paired || !keys(value, ['type', 'id', 'pairId', 'method', 'args']) || value.type !== 'request'
    || !Number.isSafeInteger(value.id) || value.id < 1 || value.pairId !== paired.pairId) return false
  if (value.method === 'snapshot' || value.method === 'show') return keys(value.args, [])
  if (value.method !== 'send' || !keys(value.args, ['request'])) return false
  const request = value.args.request
  return keys(request, ['requestId', 'revision', 'text']) && typeof request.requestId === 'string'
    && /^[a-zA-Z0-9_-]{8,200}$/.test(request.requestId) && Number.isSafeInteger(request.revision) && request.revision >= 0
    && typeof request.text === 'string' && request.text.length > 0 && request.text.length <= 131072
}
async function execute(request, binding, owned) {
  // activeTab access is revoked on cross-origin navigation; never inspect or inject into login pages.
  const tab = await chrome.tabs.get(binding.tabId)
  if (!owned()) throw new Error('Revoked browser operation')
  if (canonical(tab.url) !== binding.url) {
    if (request.method === 'show') throw new Error('Original Dot is no longer selected')
    return request.method === 'send' ? { status: 'refused', snapshot: unavailable(binding.url) } : unavailable(binding.url)
  }
  if (request.method === 'show') {
    await chrome.tabs.update(binding.tabId, { active: true })
    if (!owned()) throw new Error('Revoked browser operation')
    await chrome.windows.update(tab.windowId, { focused: true })
    return null
  }
  return chrome.tabs.sendMessage(binding.tabId, { type: 'skeinlet-command', method: request.method,
    url: binding.url, args: request.args }, { documentId: binding.documentId })
}
chrome.action.onClicked.addListener(async tab => {
  const generation = ++actionGeneration
  const currentAction = () => generation === actionGeneration
  port?.disconnect()
  port = undefined
  paired = undefined
  selected = undefined
  const url = canonical(tab.url)
  if (url === null || !Number.isSafeInteger(tab.id)) {
    await chrome.action.setBadgeText({ text: '?' })
    if (!currentAction()) return
    await chrome.action.setTitle({ title: 'Open your selected ChatGPT Dot and click again.' })
    return
  }
  try {
    const documents = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => location.href })
    if (!currentAction()) return
    const main = documents.find(result => result.frameId === 0)
    if (!main?.documentId || canonical(main.result) !== url) throw new Error('Wrong selected document')
    await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds: [main.documentId] }, world: 'ISOLATED', files: ['content.js'] })
    if (!currentAction()) return
    const connection = chrome.runtime.connectNative(HOST)
    port = connection
    selected = { tabId: tab.id, documentId: main.documentId, url }
    paired = undefined
    connection.onMessage.addListener(message => {
      if (port !== connection) return
      if (keys(message, ['type', 'version', 'pairId', 'url']) && message.type === 'paired' && message.version === 1
        && typeof message.pairId === 'string' && /^[a-f0-9]{32}$/.test(message.pairId) && message.url === selected?.url) {
        paired = { ...selected, pairId: message.pairId }
        void chrome.action.setBadgeText({ text: 'ON' })
        void chrome.action.setTitle({ title: 'This Dot is connected to Skeinlet. Click to pair again.' })
        return
      }
      if (!validRequest(message)) { connection.disconnect(); return }
      const binding = paired
      const owned = () => paired === binding && port === connection
      void execute(message, binding, owned).then(value => {
        if (paired === binding && port === connection) connection.postMessage({ type: 'response', id: message.id, pairId: binding.pairId, ok: true, value })
      }).catch(() => {
        if (message.method === 'show') {
          if (paired === binding && port === connection) connection.postMessage({ type: 'response', id: message.id, pairId: binding.pairId, ok: false, code: 'unavailable' })
          return
        }
        if (paired === binding && port === connection) connection.postMessage({ type: 'response', id: message.id, pairId: binding.pairId,
          ok: true, value: message.method === 'snapshot' ? unavailable(binding.url)
            : message.method === 'send' ? { status: 'unknown', snapshot: unavailable(binding.url) } : null })
      })
    })
    connection.onDisconnect.addListener(() => {
      if (port !== connection) return
      // Consume Chrome's diagnostic without exporting it; it can contain local paths.
      void chrome.runtime.lastError
      paired = undefined
      selected = undefined
      port = undefined
      void chrome.action.setBadgeText({ text: '?' })
      void chrome.action.setTitle({ title: 'Select this Dot in Skeinlet, then click to connect again.' })
    })
    connection.postMessage({ type: 'pair', version: 1, ...selected })
  } catch {
    if (!currentAction()) return
    void chrome.action.setBadgeText({ text: '?' })
    void chrome.action.setTitle({ title: 'Unable to connect. Select this Dot in Skeinlet and check the installed native helper.' })
  }
})
