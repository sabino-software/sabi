/** Only the local toolbar receives this bridge; website documents have no chrome capabilities. */
const api = window.dshAxiomWindow
const unsubscribe = api.subscribe(labels => {
  document.getElementById('title').textContent = labels.title
  for (const key of ['reload', 'close']) {
    const button = document.getElementById(key)
    button.textContent = labels[key]
    button.disabled = false
  }
})
document.getElementById('reload').addEventListener('click', () => { api.reload() })
document.getElementById('close').addEventListener('click', () => { api.close() })
window.addEventListener('pagehide', unsubscribe, { once: true })
