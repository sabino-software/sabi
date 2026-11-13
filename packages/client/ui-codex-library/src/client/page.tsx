/** Connection management; conversations remain in the standard workspace sidebar. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconLayersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { AxiomBrowserSetup, AxiomTransportMode, DesktopAxiomCompanion } from './desktop-axiom.ts'
import type { DotControlsInjected } from './dot-controls.tsx'
import css from './page.module.css'

/** Operations exposed by the native-conversation Host service. */
export interface NativeConnectionsInjected extends DotControlsInjected {
  /** Optional desktop-only browser companion controls; absent in ordinary Web. */
  readonly axiomCompanion?: DesktopAxiomCompanion
  /** Explicitly select the authenticated work subscription for future chats. */
  useCodex(this: void): Promise<void>
  /** Begin managed Codex OAuth; the returned link opens in the regular browser. */
  startCodexLogin(this: void): Promise<{ authUrl: string }>
  /** Cancel this app's pending managed login. */
  cancelCodexLogin(this: void): Promise<void>
  /** Import existing Codex threads into the standard workspace list. */
  syncCodex(this: void): Promise<{ imported: number }>
  /** Reveal the original ChatGPT login in the desktop bridge. */
  showAxiomLogin(this: void): Promise<void>
}

type PageProps = PropsRuntime<'main'> & PropsLocale<'codexLibrary'> & InjectFace<NativeConnectionsInjected>

/**
 * Render the connection panel's standard navigation glyph.
 * @param props - Requested sidebar icon size.
 * @returns The noninteractive glyph.
 */
export function CodexLibraryIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconLayersOutlineRegular size={size} />
}

/**
 * Render connection status and explicit sync, connect, and login operations.
 * @param props - Framework resource hooks, localized copy, and Host operation callbacks.
 * @returns The connection-management page.
 */
export function CodexLibraryPage({
  useResource, t, syncCodex, chooseDot, useDot, showAxiomLogin, startCodexLogin, cancelCodexLogin, axiomCompanion, useCodex,
}: PageProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [companionRevision, setCompanionRevision] = useState(0)
  const [transport, setTransport] = useState<AxiomTransportMode | null>(null)
  const [setup, setSetup] = useState<AxiomBrowserSetup | null>(null)
  const [transportBusy, setTransportBusy] = useState(false)
  const [transportError, setTransportError] = useState(false)
  const dot = useDot(value => value)
  const [busy, setBusy] = useState<'sync' | 'connect' | 'login' | 'codex-login' | 'codex-cancel' | 'codex-select' | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState<number | null>(null)
  const status = useResource<'native-conversation-status'>(`dsh-resource://native-conversation-status/?revision=${revision}`)
  const refresh = (): void => { setRevision(value => value + 1); setCompanionRevision(value => value + 1) }
  const login = status.value?.codex.login
  const pendingLogin = authUrl !== null || login?.phase === 'starting' || login?.phase === 'awaiting-browser'
    || login?.phase === 'verifying' || login?.phase === 'cancelling'
  useEffect(() => {
    if (!pendingLogin) return
    const timer = setInterval(() => { setRevision(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [pendingLogin])
  useEffect(() => {
    if (login?.phase === 'succeeded' || login?.phase === 'failed' || login?.phase === 'cancelled') setAuthUrl(null)
  }, [login?.phase])
  useEffect(() => {
    if (axiomCompanion === undefined) return
    let active = true
    setTransportBusy(true)
    setTransportError(false)
    void Promise.all([axiomCompanion.transport(), axiomCompanion.browserSetup()]).then(([mode, metadata]) => {
      if (active) { setTransport(mode); setSetup(metadata) }
    }).catch(() => { if (active) setTransportError(true) }).finally(() => { if (active) setTransportBusy(false) })
    return () => { active = false }
  }, [axiomCompanion, companionRevision])
  const chooseTransport = async (mode: AxiomTransportMode): Promise<void> => {
    if (axiomCompanion === undefined || transportBusy || busy !== null) return
    setTransportBusy(true)
    setTransportError(false)
    try {
      await axiomCompanion.selectTransport(mode)
      setTransport(await axiomCompanion.transport())
    } catch (_refusedSwitch: unknown) { setTransportError(true) }
    finally { setTransportBusy(false) }
  }
  const run = async (action: NonNullable<typeof busy>): Promise<void> => {
    setBusy(action)
    setError(null)
    setImported(null)
    try {
      if (action === 'sync') setImported((await syncCodex()).imported)
      else if (action === 'connect') await chooseDot()
      else if (action === 'login') await showAxiomLogin()
      else if (action === 'codex-select') await useCodex()
      else if (action === 'codex-cancel') { await cancelCodexLogin(); setAuthUrl(null) }
      else {
        const result = await startCodexLogin()
        const destination = new URL(result.authUrl)
        if (!['https://auth.openai.com', 'https://chatgpt.com'].includes(destination.origin)
          || destination.username || destination.password || destination.hash) throw new Error(t('codexLoginError'))
        setAuthUrl(destination.href)
      }
      refresh()
    } catch (failure) {
      if (action === 'codex-login' || action === 'codex-cancel' || action === 'codex-select') {
        setError(t(action === 'codex-select' ? 'codexSelectError' : 'codexLoginError'))
        refresh()
      } else setError(failure instanceof Error ? failure.message : t('actionError'))
    } finally {
      setBusy(null)
    }
  }
  const disabled = busy !== null || transportBusy || status.value?.syncing === true
  const axiomDisabled = disabled || status.value?.axiom.available !== true || transportError
    || (axiomCompanion !== undefined && transport === null)
    || (transport === 'browser' && setup?.available !== true)
  return <section className={css.page} aria-label={t('title')}>
    <header className={css.header}>
      <div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <Button size="sm" variant="outline" onClick={refresh} disabled={busy !== null || transportBusy}>{t('refresh')}</Button>
    </header>
    {status.status === 'loading' && <p role="status">{t('loading')}</p>}
    {status.status === 'failed' && <p role="alert">{t('statusError')}</p>}
    {error !== null && <p role="alert">{error}</p>}
    {imported !== null && <p role="status">{t('synced', { count: imported })}</p>}
    <section className={css.connection} aria-labelledby="native-codex-heading">
      <div><h2 id="native-codex-heading">{t('codex')}</h2><p>{t('codexDescription')}</p></div>
      {status.value !== undefined && <p>{t(status.value.codex.connected ? 'connected' : 'disconnected')}</p>}
      {status.value !== undefined && <p>{t(status.value.codex.authenticated ? 'codexSignedIn' : 'codexSignedOut')}</p>}
      {status.value?.codex.selected === true && <p role="status">{t('codexSelected')}</p>}
      {status.value?.codex.authenticated === true && !status.value.codex.selected && <div>
        <Button size="sm" variant="outline" disabled={disabled || pendingLogin} onClick={() => { void run('codex-select') }}>
          {t(busy === 'codex-select' ? 'codexSelecting' : 'codexSelect')}
        </Button>
      </div>}
      {login?.error != null && <p role="alert">{login.error}</p>}
      {pendingLogin && <p role="status">{t(login?.phase === 'verifying' ? 'codexLoginVerifying' : 'codexLoginPending')}</p>}
      {login?.phase === 'succeeded' && <p role="status">{t('codexLoginSucceeded')}</p>}
      {login?.phase === 'cancelled' && <p role="status">{t('codexLoginCancelled')}</p>}
      {(!status.value?.codex.authenticated || pendingLogin) && <div className={css.actions}>
        {!status.value?.codex.authenticated && <Button size="sm" variant="outline" disabled={disabled || pendingLogin || status.value?.codex.connected !== true}
          onClick={() => { void run('codex-login') }}>{t('codexLogin')}</Button>}
        {authUrl !== null && <a href={authUrl} target="_blank" rel="noopener noreferrer">{t('codexLoginBrowser')}</a>}
        {login?.phase === 'awaiting-browser' && <Button size="sm" variant="outline" disabled={busy !== null}
          onClick={() => { void run('codex-cancel') }}>{t('codexLoginCancel')}</Button>}
      </div>}
      <p>{t('codexLoginBoundary')}</p>
      {status.value?.codex.error != null && <p role="alert">{status.value.codex.error}</p>}
      <div><Button size="sm" variant="outline" disabled={disabled} onClick={() => { void run('sync') }}>
        {t(busy === 'sync' || status.value?.syncing ? 'syncing' : 'sync')}
      </Button></div>
    </section>
    <section className={css.connection} aria-labelledby="native-axiom-heading">
      <div><h2 id="native-axiom-heading">{t('axiom')}</h2><p>{t('axiomDescription')}</p></div>
      {status.value !== undefined && <p>{t(status.value.axiom.available ? 'bridgeAvailable' : 'bridgeUnavailable')}
        {status.value.axiom.phase !== '' && <> · <code>{status.value.axiom.phase}</code></>}</p>}
      {axiomCompanion !== undefined && <div className={css.form}>
        <label htmlFor="native-axiom-transport">{t('axiomTransport')}</label>
        <select id="native-axiom-transport" value={transport ?? ''} disabled={disabled || transportBusy}
          onChange={(event) => {
            const mode = event.currentTarget.value
            if (mode === 'browser' || mode === 'embedded') void chooseTransport(mode)
          }}>
          <option value="" disabled>{t('axiomTransportLoading')}</option>
          <option value="embedded">{t('axiomTransportEmbedded')}</option>
          <option value="browser">{t('axiomTransportBrowser')}</option>
        </select>
        {transportBusy && <p role="status">{t('axiomTransportLoading')}</p>}
        {transportError && <p role="alert">{t('axiomTransportError')}</p>}
        {transport === 'browser' && <>
          <p>{t('axiomBrowserPrivacy')}</p>
          {setup?.available !== true ? <p role="status">{t('axiomBrowserUnavailable')}</p> : <details>
            <summary>{t('axiomBrowserSetup')}</summary>
            <p>{t('axiomBrowserInstall')}</p>
            <p>{t('axiomBrowserPair')}</p>
            <dl>
              <dt>{t('axiomExtensionDirectory')}</dt><dd><code>{setup.extensionDirectory}</code></dd>
              <dt>{t('axiomRegistrationScript')}</dt><dd><code>{setup.registrationScript}</code></dd>
              <dt>{t('axiomNativeHost')}</dt><dd><code>{setup.nativeHostScript}</code></dd>
              <dt>{t('axiomNodeExecutable')}</dt><dd><code>{setup.nodeExecutable}</code></dd>
              <dt>{t('axiomHostName')}</dt><dd><code>{setup.hostName}</code></dd>
              <dt>{t('axiomExtensionId')}</dt><dd><code>{setup.extensionId}</code></dd>
              <dt>{t('axiomBrowserPermissions')}</dt><dd><code>{setup.permissions.join(', ')}</code></dd>
            </dl>
          </details>}
        </>}
      </div>}
      {dot.pending && <p role="status">{t('dotSelectionPending')}</p>}
      {dot.failed && <p role="alert">{t('dotSelectionError')}</p>}
      <div className={css.actions}>
        <Button type="button" size="sm" variant="outline"
          disabled={axiomDisabled || !dot.preferences?.enabled || dot.busy}
          onClick={() => { void run('connect') }}>{t(busy === 'connect' || dot.busy ? 'connecting' : 'connect')}</Button>
        <Button type="button" size="sm" variant="outline" disabled={axiomDisabled || !dot.preferences?.enabled}
          onClick={() => { void run('login') }}>{t(busy === 'login' ? 'openingLogin' : 'login')}</Button>
      </div>
    </section>
  </section>
}
