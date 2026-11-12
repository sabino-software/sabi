/** Origin-scoped native access to the user-selected original Dot page. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { AxiomSendResult, AxiomSnapshot, DesktopAxiomBridge } from './axiom-protocol.ts'

/** @returns Page operations without browser storage or general script execution access. */
export function createDesktopAxiomBridge(): DesktopAxiomBridge {
  return {
    connect: url => ipcRenderer.invoke(DESKTOP_IPC.axiomConnect, url) as Promise<AxiomSnapshot>,
    snapshot: () => ipcRenderer.invoke(DESKTOP_IPC.axiomSnapshot) as Promise<AxiomSnapshot>,
    send: request => ipcRenderer.invoke(DESKTOP_IPC.axiomSend, request) as Promise<AxiomSendResult>,
    showLogin: () => ipcRenderer.invoke(DESKTOP_IPC.axiomShowLogin) as Promise<void>,
    disconnect: () => ipcRenderer.invoke(DESKTOP_IPC.axiomDisconnect) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: AxiomSnapshot): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.axiomChanged, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.axiomChanged, handle) }
    },
  }
}
