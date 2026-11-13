/** Isolated fixed-action bridge for the original-site window's trusted toolbar. */
import { contextBridge, ipcRenderer } from 'electron'
import { AXIOM_WINDOW_IPC, AXIOM_WINDOW_PAGE, type AxiomWindowApi, type AxiomWindowLabels } from './axiom-window-protocol.ts'

const api: AxiomWindowApi = {
  reload: () => { ipcRenderer.send(AXIOM_WINDOW_IPC.command, 'reload') },
  close: () => { ipcRenderer.send(AXIOM_WINDOW_IPC.command, 'close') },
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, labels: AxiomWindowLabels): void => { listener(labels) }
    ipcRenderer.on(AXIOM_WINDOW_IPC.labels, receive)
    ipcRenderer.send(AXIOM_WINDOW_IPC.command, 'status')
    return () => { ipcRenderer.off(AXIOM_WINDOW_IPC.labels, receive) }
  },
}
if (location.href === AXIOM_WINDOW_PAGE) contextBridge.exposeInMainWorld('dshAxiomWindow', api)
