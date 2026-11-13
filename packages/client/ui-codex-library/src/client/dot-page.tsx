/** Dedicated original Dot transcript and composer, independent of Harness Session rendering. */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, InlineEditor, MarkdownText, IconSendOutlineRegular, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DotState } from './dot-controller.ts'
import type { DotMessage } from './desktop-axiom.ts'
import css from './dot-page.module.css'

/** Direct website state and explicit user actions supplied by this feature's controller. */
export interface DotPageInjected {
  hooks: { dot: ObservableSnapshot<DotState> }
  setDotDraft(text: string): void
  sendDot(): Promise<void>
  loadDotHistory(): Promise<void>
  showDotOriginal(): Promise<void>
}

type Copy = PropsLocale<'codexLibrary'>['t']

/**
 * Render only original-source messages and a direct website composer.
 * @param props - Framework-bound source observations and explicit desktop operations.
 * @returns The continuous Dot conversation; no ordinary chat or history launcher is included.
 */
export function DotPage({ useDot, setDotDraft, sendDot, loadDotHistory, showDotOriginal, t }:
  PropsRuntime<'main'> & PropsLocale<'codexLibrary'> & InjectFace<DotPageInjected>): ReactNode {
  const state = useDot(value => value)
  const title = state.selection?.title || t('dot')
  const [originalFailed, setOriginalFailed] = useState(false)
  const connected = state.preferences?.enabled === true && state.snapshot?.phase === 'ready'
  const canSend = connected && state.snapshot.canSend && !state.snapshot.draftPresent && !state.sending && !!state.draft.trim()
  return <section className={css.page} aria-label={title}>
    <header className={css.header}>
      <div className={css.identity}><span className={css.ring} aria-hidden="true" /><h1>{title}</h1></div>
      <Button className={css.openOriginal} size="sm" variant="ghost" onClick={() => {
        setOriginalFailed(false)
        void showDotOriginal().catch(() => { setOriginalFailed(true) })
      }}>{t('openOriginal')}</Button>
    </header>
    {!state.preferences?.enabled && <p className={css.notice} role="status">{t('dotDisabled')}</p>}
    {(state.busy || state.pending) && <p className={css.notice} role="status">{t('dotSelectionPending')}</p>}
    {state.failed && <p className={css.notice} role="alert">{t('dotSelectionError')}</p>}
    {originalFailed && <p className={css.notice} role="alert">{t('openOriginalError')}</p>}
    {!state.busy && !state.pending && state.snapshot?.phase === 'disconnected'
      && <p className={css.notice} role="status">{t('dotReconnect')}</p>}
    <DotTimeline key={state.selection?.url ?? 'unselected'} messages={state.messages} history={state.history} hasMore={state.hasMore}
      loadOlder={loadDotHistory} t={t} />
    <div className={css.composerArea}>
      {state.snapshot?.siteStatus && <p className={css.notice} role="status">{state.snapshot.siteStatus}</p>}
      {state.snapshot?.draftPresent && <p className={css.notice} role="status">{t('dotOriginalDraft')}</p>}
      {state.sendOutcome !== null && state.sendOutcome !== 'confirmed'
        && <p className={css.notice} role="alert">{t(state.sendOutcome === 'refused' ? 'dotSendRefused' : 'dotSendUnknown')}</p>}
      <form className={css.composer} onSubmit={(event) => { event.preventDefault(); if (canSend) void sendDot() }}>
        <InlineEditor value={state.draft} label={t('dotComposer')} onChange={setDotDraft}
          onSave={() => { if (canSend) void sendDot() }} onCancel={() => { setDotDraft('') }} className={css.editor ?? ''} />
        <Button className={css.send} type="submit" variant="ghost" disabled={!canSend} aria-label={t(state.sending ? 'dotSending' : 'dotSend')}>
          {state.sending ? <IconLoadingOutlineRegular size={20} /> : <IconSendOutlineRegular size={20} />}
        </Button>
      </form>
      <p className={css.sourceNote}>{t('dotSourceBoundary')}</p>
    </div>
  </section>
}

function DotTimeline({ messages, history, hasMore, loadOlder, t }: {
  messages: readonly DotMessage[]
  history: DotState['history']
  hasMore: boolean
  loadOlder(this: void): Promise<void>
  t: Copy
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const anchor = useRef<{ id: string; offset: number } | null>(null)
  const loading = useRef(false)
  const userScroll = useRef(false)
  const scrollIntent = (): void => {
    anchor.current = null
    atBottom.current = false
    userScroll.current = true
  }
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messages.length,
    getScrollElement: () => scroller.current,
    getItemKey: index => messages[index]?.id ?? index,
    estimateSize: () => 120,
    overscan: 6,
    onChange: (instance, synchronous) => {
      if (synchronous || !atBottom.current || anchor.current !== null) return
      const node = scroller.current
      if (node === null) return
      const bottom = Math.max(0, instance.getTotalSize() - node.clientHeight)
      if (Math.abs(node.scrollTop - bottom) > 1) instance.scrollToOffset(bottom)
    },
  })
  const older = useCallback(async (): Promise<void> => {
    if (loading.current || !hasMore || history === 'loading') return
    const node = scroller.current
    const first = virtualizer.getVirtualItems().find(item => item.end > (node?.scrollTop ?? 0))
    if (first !== undefined) {
      const message = messages[first.index]
      if (message !== undefined) anchor.current = { id: message.id, offset: first.start - (node?.scrollTop ?? 0) }
    }
    atBottom.current = false
    userScroll.current = false
    loading.current = true
    try { await loadOlder() } finally { loading.current = false }
  }, [hasMore, history, loadOlder, messages, virtualizer])
  const rows = virtualizer.getVirtualItems()
  // A virtualized prepend needs the source-ID anchor's measured offset; CSS cannot preserve a row absent from the old DOM.
  useLayoutEffect(() => {
    const saved = anchor.current
    if (saved !== null && history !== 'loading') {
      const index = messages.findIndex(message => message.id === saved.id)
      const position = virtualizer.measurementsCache[index]
      if (position !== undefined) {
        const offset = position.start - saved.offset
        if (Math.abs((scroller.current?.scrollTop ?? 0) - offset) > 0.5) virtualizer.scrollToOffset(offset)
      }
      // Retain the source-ID anchor through later Markdown measurement; only a new user scroll releases it.
    } else if (atBottom.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [messages, history, rows, virtualizer])
  const labels = useMemo(() => ({ code: { copyLabel: t('dotCopy'), copiedLabel: t('dotCopied'), toolbarLabels: {
    codeLabel: t('dotCode'), wrapLabel: t('dotWrap'), unwrapLabel: t('dotUnwrap'),
  } }, footnotes: t('dotFootnotes') }), [t])
  return <div className={css.timeline}>
    <div className={css.history}>
      {hasMore ? <Button size="sm" variant="ghost" disabled={history === 'loading'} onClick={() => { void older() }}>
        {t(history === 'loading' ? 'dotHistoryLoading' : history === 'unavailable' ? 'dotHistoryRetry' : 'dotHistoryOlder')}
      </Button> : <span>{t('dotHistoryStart')}</span>}
      {history === 'unavailable' && <p role="status">{t('dotHistoryUnavailable')}</p>}
    </div>
    <div ref={scroller} className={css.scroll} aria-label={t('dotTimeline')} tabIndex={0}
      onWheel={scrollIntent} onTouchStart={scrollIntent} onPointerDown={scrollIntent}
      onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) scrollIntent() }}
      onScroll={() => {
        const node = scroller.current
        if (node === null || !userScroll.current) return
        atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 64
        if (node.scrollTop <= 120 && hasMore && history !== 'unavailable') void older()
      }}>
      <div className={css.virtualContent} style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => {
          const message = messages[row.index]
          if (message === undefined) return null
          const date = message.timestamp === null ? null : new Date(message.timestamp)
          const previous = messages[row.index - 1]
          const priorDate = previous?.timestamp == null ? null : new Date(previous.timestamp)
          const divider = date !== null && Number.isFinite(date.getTime())
            && (priorDate === null || date.toDateString() !== priorDate.toDateString())
          return <div key={message.id} ref={virtualizer.measureElement} data-index={row.index} className={css.row}
            data-dot-message-id={message.id} data-role={message.role} style={{ transform: `translateY(${row.start}px)` }}>
            {divider && <time className={css.timestampDivider} dateTime={date.toISOString()}>{date.toLocaleDateString()}</time>}
            <article className={css.bubble} aria-label={t(message.role === 'user' ? 'dotUserMessage' : 'dotAssistantMessage')}>
              <MarkdownText text={message.text} labels={labels} omitHtml omitImages />
              {message.truncated && <p className={css.truncated}>{t('dotMessageTruncated')}</p>}
            </article>
          </div>
        })}
      </div>
    </div>
  </div>
}
