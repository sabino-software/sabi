/** Trusted, separately bounded native-window chrome around an isolated original website. */
import { BrowserWindow, ipcMain, Menu, WebContentsView, type BrowserWindowConstructorOptions, type IpcMainEvent, type WebContents, type WebContentsViewConstructorOptions } from 'electron'
import { fileURLToPath } from 'node:url'
import { AXIOM_WINDOW_IPC, AXIOM_WINDOW_PAGE, type AxiomWindowLabels } from './axiom-window-protocol.ts'

const en: AxiomWindowLabels = { title: 'Original ChatGPT', reload: 'Reload page', close: 'Close page' }
const zh: AxiomWindowLabels = { title: '原始 ChatGPT', reload: '重新加载页面', close: '关闭页面' }
const pt: AxiomWindowLabels = { title: 'ChatGPT original', reload: 'Recarregar página', close: 'Fechar página' }

/** Website content and its native window retain distinct ownership and permissions. */
export interface AxiomWebsiteWindow { readonly window: BrowserWindow; readonly contents: WebContents }
type WebsiteWindowOptions = BrowserWindowConstructorOptions & Pick<WebContentsViewConstructorOptions, 'webContents'>

/**
 * @param options Original-site window options, including its retained session and Chromium popup opener preferences.
 * @param locale Shell locale; unlisted languages use English.
 * @returns A real closable window with a trusted toolbar above, never over, its isolated website.
 */
export function createAxiomWebsiteWindow(options: WebsiteWindowOptions, locale: string): AxiomWebsiteWindow {
  const labels = locale.startsWith('zh') ? zh : locale.startsWith('pt') ? pt : en
  const { webContents: popupContents, webPreferences: websitePreferences, ...windowOptions } = options
  const window = new BrowserWindow({ ...windowOptions, modal: false, webPreferences: {
    preload: fileURLToPath(new URL('./preload-axiom-window.cjs', import.meta.url)),
    contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
  } })
  const website = new WebContentsView({ ...popupContents === undefined ? {} : { webContents: popupContents },
    webPreferences: { ...websitePreferences, preload: undefined,
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false,
    } })
  const contents = website.webContents
  window.contentView.addChildView(website)
  const resize = (): void => {
    const { width, height } = window.getContentBounds()
    website.setBounds({ x: 0, y: 48, width, height: Math.max(0, height - 48) })
  }
  const focus = (): void => { if (!window.isDestroyed() && window.isFocused() && !contents.isDestroyed()) contents.focus() }
  const reload = (): void => { if (!contents.isDestroyed()) { contents.reload(); focus() } }
  const command = (event: IpcMainEvent, value: unknown): void => {
    if (event.sender !== window.webContents || event.senderFrame === null || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url !== AXIOM_WINDOW_PAGE) return
    if (value === 'status') event.sender.send(AXIOM_WINDOW_IPC.labels, labels)
    else if (value === 'reload') reload()
    else if (value === 'close') window.close()
  }
  const shortcuts = (event: Electron.Event, input: Electron.Input): void => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'r' && (input.meta || input.control)) {
      event.preventDefault()
      reload()
    }
  }
  ipcMain.on(AXIOM_WINDOW_IPC.command, command)
  window.on('resize', resize)
  window.on('focus', focus)
  contents.on('did-finish-load', focus)
  contents.once('destroyed', () => { if (!window.isDestroyed()) window.destroy() })
  contents.on('before-input-event', shortcuts)
  window.webContents.on('before-input-event', shortcuts)
  window.webContents.on('will-navigate', (event, url) => { if (url !== AXIOM_WINDOW_PAGE) event.preventDefault() })
  window.webContents.on('will-redirect', (event) => { event.preventDefault() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('closed', () => {
    ipcMain.off(AXIOM_WINDOW_IPC.command, command)
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
  })
  if (process.platform !== 'darwin') window.setMenu(Menu.buildFromTemplate([
    { label: labels.reload, click: reload }, { label: labels.close, click: () => { window.close() } },
  ]))
  resize()
  void window.loadURL(AXIOM_WINDOW_PAGE).catch((_chromeUnavailable: unknown) => { if (!window.isDestroyed()) window.destroy() })
  return { window, contents }
}
