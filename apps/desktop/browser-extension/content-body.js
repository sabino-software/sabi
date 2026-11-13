// This file is wrapped with the shared DOM reader and fixed composer functions by prepare-axiom-browser.ts.
const previous = globalThis.__skeinletAxiomContent
if (typeof previous === 'function') previous()
let current
let busy = false
const submissions = new Map()
const usedRequests = new Set()
function canonical(value) {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.search || url.hash
      || !/^\/dots\/[a-zA-Z0-9_~-]+\/?$/.test(url.pathname)) return null
    return url.href.replace(/\/$/, '')
  } catch { return null }
}
function snapshot(url) {
  if (canonical(location.href) !== url) throw new Error('Wrong selected document')
  const state = readAxiomPage()
  const next = { source: 'chatgpt-web', url, title: state.title, revision: current?.revision ?? 0,
    phase: state.composer ? 'ready' : 'unavailable', messages: state.composer ? state.messages : [],
    canSend: state.composer && state.sendPresent, draftPresent: state.draft.trim() !== '', siteStatus: state.siteStatus, limited: true }
  if (current === undefined || JSON.stringify(next) !== JSON.stringify(current)) next.revision++
  current = next
  return next
}
async function submit(request, url) {
  if (typeof request?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,200}$/.test(request.requestId)
    || !Number.isSafeInteger(request.revision) || request.revision < 0 || typeof request.text !== 'string'
    || request.text.length === 0 || request.text.length > 131072) throw new Error('Invalid submission')
  const prior = submissions.get(request.requestId)
  if (prior) return prior.text === request.text ? prior.result : { status: 'refused', snapshot: snapshot(url) }
  if (usedRequests.has(request.requestId)) return { status: 'refused', snapshot: snapshot(url) }
  usedRequests.add(request.requestId)
  if (submissions.size >= 32) submissions.delete(submissions.keys().next().value)
  const result = send(request, url)
  submissions.set(request.requestId, { text: request.text, result })
  return result
}
async function send(request, url) {
  const state = snapshot(url)
  if (busy || !state.canSend || state.draftPresent || request.text.trim() === '' || request.revision !== state.revision) return { status: 'refused', snapshot: state }
  busy = true
  let clicked = false
  try {
    const ids = Array.from(document.querySelectorAll('article.message-row[data-message-id]'), row => row.getAttribute('data-message-id'))
    if (ids.length > 10000 || !focusAxiomComposer()) return { status: 'refused', snapshot: snapshot(url) }
    // Browser editing only. If the real editor rejects this command, preserve the draft and refuse.
    if (!document.execCommand('insertText', false, request.text)) return { status: 'refused', snapshot: snapshot(url) }
    // React may enable Send after the input handler returns. Admit only the unchanged inserted draft.
    const editorDeadline = Date.now() + 2000
    const insertedComposer = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label="Message"]')
    for (;;) {
      if (canonical(location.href) !== url) return { status: 'unknown', snapshot: state }
      const composer = document.querySelector('div[role="textbox"][contenteditable="true"][aria-label="Message"]')
      const sendControl = document.querySelector('button[aria-label="Send"]')
      if (!(composer instanceof HTMLElement) || composer !== insertedComposer || composer.getAttribute('aria-disabled') === 'true'
        || composer.innerText.replaceAll('\r\n', '\n') !== request.text || !(sendControl instanceof HTMLButtonElement)) {
        return { status: 'refused', snapshot: snapshot(url) }
      }
      if (Date.now() >= editorDeadline) return { status: 'refused', snapshot: snapshot(url) }
      if (!sendControl.disabled) { clicked = clickAxiomSend(request.text); break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!clicked) return { status: 'refused', snapshot: snapshot(url) }
    const deadline = Date.now() + 12000
    while (Date.now() < deadline && canonical(location.href) === url) {
      const messageId = findAxiomAcknowledgement(request.text, ids)
      if (typeof messageId === 'string') return { status: 'confirmed', messageId, snapshot: snapshot(url) }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    return { status: 'unknown', snapshot: snapshot(url) }
  } catch {
    return { status: clicked ? 'unknown' : 'refused', snapshot: current ?? state }
  } finally { busy = false }
}
function listener(message, sender, respond) {
  if (sender.id !== chrome.runtime.id || message?.type !== 'skeinlet-command' || canonical(message.url) !== message.url) return false
  if (message.method === 'snapshot') {
    try { respond(snapshot(message.url)) } catch { respond(null) }
    return false
  }
  if (message.method === 'send') {
    void submit(message.args?.request, message.url).then(respond).catch(() => respond(null))
    return true
  }
  return false
}
chrome.runtime.onMessage.addListener(listener)
globalThis.__skeinletAxiomContent = () => { chrome.runtime.onMessage.removeListener(listener); submissions.clear(); usedRequests.clear() }
