/** Origin-scoped native access to the user-selected original Dot page. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { AxiomBrowserSetup, AxiomHistoryPage, AxiomPreferences, AxiomSelection, AxiomSendResult, AxiomSnapshot, AxiomTransportMode, DesktopAxiomBridge } from './axiom-protocol.ts'

/** @returns Page operations without browser storage or general script execution access. */
export function createDesktopAxiomBridge(): DesktopAxiomBridge {
  return {
    selection: () => ipcRenderer.invoke(DESKTOP_IPC.axiomSelection) as Promise<AxiomSelection | null>,
    historyBefore: beforeId => ipcRenderer.invoke(DESKTOP_IPC.axiomHistoryBefore, beforeId) as Promise<AxiomHistoryPage>,
    preferences: () => ipcRenderer.invoke(DESKTOP_IPC.axiomPreferences) as Promise<AxiomPreferences>,
    setPreferences: preferences => ipcRenderer.invoke(DESKTOP_IPC.axiomSetPreferences, preferences) as Promise<void>,
    choose: hintUrl => ipcRenderer.invoke(DESKTOP_IPC.axiomChoose, hintUrl) as Promise<AxiomSnapshot>,
    transport: () => ipcRenderer.invoke(DESKTOP_IPC.axiomTransport) as Promise<AxiomTransportMode>,
    selectTransport: mode => ipcRenderer.invoke(DESKTOP_IPC.axiomSelectTransport, mode) as Promise<void>,
    browserSetup: () => ipcRenderer.invoke(DESKTOP_IPC.axiomBrowserSetup) as Promise<AxiomBrowserSetup>,
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
