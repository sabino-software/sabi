/** Connection management; conversations remain in the standard workspace sidebar. */
import { useState, type ReactNode } from 'react'
import { Button, Input, IconLayersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './page.module.css'

/** Operations exposed by the native-conversation Host service. */
export interface NativeConnectionsInjected {
  /** Import existing Codex threads into the standard workspace list. */
  syncCodex(): Promise<{ imported: number }>
  /** Bind the original Axiom conversation and open its native Session. */
  connectAxiom(url: string): Promise<void>
  /** Reveal the original ChatGPT login in the desktop bridge. */
  showAxiomLogin(): Promise<void>
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
export function CodexLibraryPage({ useResource, t, syncCodex, connectAxiom, showAxiomLogin }: PageProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'sync' | 'connect' | 'login' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState<number | null>(null)
  const status = useResource<'native-conversation-status'>(`dsh-resource://native-conversation-status/?revision=${revision}`)
  const refresh = (): void => { setRevision(value => value + 1) }
  const run = async (action: NonNullable<typeof busy>): Promise<void> => {
    setBusy(action)
    setError(null)
    setImported(null)
    try {
      if (action === 'sync') setImported((await syncCodex()).imported)
      else if (action === 'connect') await connectAxiom(url)
      else await showAxiomLogin()
      refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('actionError'))
    } finally {
      setBusy(null)
    }
  }
  const disabled = busy !== null || status.value?.syncing === true
  return <section className={css.page} aria-label={t('title')}>
    <header className={css.header}>
      <div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <Button size="sm" variant="outline" onClick={refresh} disabled={busy !== null}>{t('refresh')}</Button>
    </header>
    {status.status === 'loading' && <p role="status">{t('loading')}</p>}
    {status.status === 'failed' && <p role="alert">{t('statusError')}</p>}
    {error !== null && <p role="alert">{error}</p>}
    {imported !== null && <p role="status">{t('synced', { count: imported })}</p>}
    <section className={css.connection} aria-labelledby="native-codex-heading">
      <div><h2 id="native-codex-heading">{t('codex')}</h2><p>{t('codexDescription')}</p></div>
      {status.value !== undefined && <p>{t(status.value.codex.connected ? 'connected' : 'disconnected')}</p>}
      {status.value?.codex.error != null && <p role="alert">{status.value.codex.error}</p>}
      <div><Button size="sm" variant="outline" disabled={disabled} onClick={() => { void run('sync') }}>
        {t(busy === 'sync' || status.value?.syncing ? 'syncing' : 'sync')}
      </Button></div>
    </section>
    <section className={css.connection} aria-labelledby="native-axiom-heading">
      <div><h2 id="native-axiom-heading">{t('axiom')}</h2><p>{t('axiomDescription')}</p></div>
      {status.value !== undefined && <p>{t(status.value.axiom.available ? 'bridgeAvailable' : 'bridgeUnavailable')}
        {status.value.axiom.phase !== '' && <> · <code>{status.value.axiom.phase}</code></>}</p>}
      <form className={css.form} onSubmit={(event) => { event.preventDefault(); void run('connect') }}>
        <label htmlFor="native-axiom-url">{t('url')}</label>
        <Input id="native-axiom-url" type="url" value={url} required autoComplete="off" spellCheck={false}
          onChange={(event) => { setUrl(event.currentTarget.value) }} placeholder="https://chatgpt.com/dots/…" />
        <div className={css.actions}>
          <Button type="submit" size="sm" variant="outline" disabled={disabled || status.value?.axiom.available !== true}>
            {t(busy === 'connect' ? 'connecting' : 'connect')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled || status.value?.axiom.available !== true}
            onClick={() => { void run('login') }}>{t(busy === 'login' ? 'openingLogin' : 'login')}</Button>
        </div>
      </form>
    </section>
  </section>
}
