/** Pure presentation of source chat resources; source chats have no composer. */
import { useState, type ReactNode } from 'react'
import { Button, Input, IconLayersOutlineRegular, IconSearchOutlineRegular, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { CodexChatId } from '../types.ts'
import css from './page.module.css'

type PageProps = PropsRuntime<'main'> & PropsLocale<'codexLibrary'>

function resource(protocol: string, values: Record<string, string | null>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== null) params.set(key, value)
  return `dsh-resource://${protocol}/?${params}`
}

function date(value: number): string { return new Date(value).toLocaleString() }

/**
 * Render the source library icon using the shell's shared artwork.
 * @param props - Requested icon size.
 * @returns The noninteractive glyph.
 */
export function CodexLibraryIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconLayersOutlineRegular size={size} />
}

/**
 * Render a title search, source catalog, and lazy transcript page.
 * @param props - Framework resource hooks and locale copy.
 * @returns The source chat browser.
 */
export function CodexLibraryPage({ useResource, t }: PageProps): ReactNode {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<CodexChatId | null>(null)
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const listing = useResource<'codex-chats'>(resource('codex-chats', { query, archived: String(archived), cursor, revision: String(revision) }))
  const transcript = useResource<'codex-transcript'>(selected === null ? '' : resource('codex-transcript', { id: selected, cursor: messageCursor, revision: String(revision) }))
  const labels = { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }
  return <section className={css.page} aria-label={t('title')}>
    <header className={css.header}>
      <div><p className={css.eyebrow}>{t('subtitle')}</p><h1>{t('title')}</h1></div>
      <span className={css.badge}>{t('readOnly')}</span>
      <Button size="sm" variant="outline" onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</Button>
    </header>
    <div className={css.source}>{t('source')}: <code>{listing.value?.sourceHome ?? '…'}</code></div>
    <div className={css.workspace} data-reading={selected !== null ? '' : undefined}>
      <aside className={css.catalog} aria-label={t('title')}>
        <form className={css.search} onSubmit={(event) => { event.preventDefault(); setQuery(draft); setCursor(null) }}>
          <Input aria-label={t('search')} placeholder={t('search')} value={draft} maxLength={200}
            icon={<IconSearchOutlineRegular size={16} />} onChange={(event) => { setDraft(event.currentTarget.value) }} />
          <Button type="submit" size="sm" variant="outline">{t('searchAction')}</Button>
        </form>
        <div className={css.filters} role="group" aria-label={t('archiveFilter')}>
          <Button size="sm" variant={!archived ? 'outline' : 'ghost'} aria-pressed={!archived} onClick={() => { setArchived(false); setCursor(null) }}>{t('active')}</Button>
          <Button size="sm" variant={archived ? 'outline' : 'ghost'} aria-pressed={archived} onClick={() => { setArchived(true); setCursor(null) }}>{t('archived')}</Button>
        </div>
        <div className={css.chats} aria-busy={listing.status === 'loading'}>
          {listing.status === 'loading' && <div className={css.skeleton} role="status" aria-label={t('loading')}><span /><span /><span /></div>}
          {listing.status === 'failed' && <p role="alert" className={css.notice}>{t('error')}</p>}
          {listing.status === 'live' && listing.value?.chats.length === 0 && <p className={css.notice}>{t('empty')}</p>}
          {listing.value?.chats.map(chat => <button type="button" key={chat.id} className={css.chat} aria-pressed={selected === chat.id}
            onClick={() => { setSelected(chat.id); setMessageCursor(null) }}>
            <span className={css.chatTitle}>{chat.title}</span>
            <span className={css.chatPath} title={chat.cwd}>{chat.cwd}</span>
            <time dateTime={new Date(chat.updatedAt).toISOString()}>{date(chat.updatedAt)}</time>
          </button>)}
        </div>
        <div className={css.paging}>
          {cursor !== null && <Button size="sm" onClick={() => { setCursor(null) }}>{t('first')}</Button>}
          {listing.value?.nextCursor != null && <Button size="sm" variant="outline" onClick={() => { setCursor(listing.value?.nextCursor ?? null) }}>{t('next')}</Button>}
        </div>
      </aside>
      <article className={css.transcript} aria-busy={transcript.status === 'loading'}>
        {selected === null ? <div className={css.empty}>{t('select')}</div> : <>
          <Button className={css.back} size="sm" onClick={() => { setSelected(null) }}>{t('back')}</Button>
          <div className={css.transcriptHeader}><h2>{transcript.value?.chat.title ?? ''}</h2><p>{t('textOnly')}</p></div>
          {transcript.status === 'loading' && <p role="status" className={css.notice}>{t('loadingTranscript')}</p>}
          {transcript.status === 'failed' && <p role="alert" className={css.notice}>{t('transcriptError')}</p>}
          {transcript.value !== undefined && <>
            <div className={css.paging}>
              {transcript.value.nextCursor !== null && <Button size="sm" variant="outline" onClick={() => { setMessageCursor(transcript.value?.nextCursor ?? null) }}>{t('older')}</Button>}
              {messageCursor !== null && <Button size="sm" onClick={() => { setMessageCursor(null) }}>{t('latest')}</Button>}
            </div>
            {transcript.value.limited && <p className={css.notice}>{t('limited')}</p>}
            {transcript.value.messages.length === 0 && <p className={css.notice}>{t('noMessages')}</p>}
            {transcript.value.messages.map(message => <section className={css.message} key={message.id} data-role={message.role}>
              <div className={css.messageMeta}><span>{t(message.role === 'user' ? 'user' : 'assistant')}</span>
                {message.timestamp !== null && <time dateTime={new Date(message.timestamp).toISOString()}>
                  {date(message.timestamp)}</time>}</div>
              <MarkdownText text={message.text} labels={labels} variant="compact" omitHtml omitImages />
            </section>)}
          </>}
        </>}
      </article>
    </div>
  </section>
}
