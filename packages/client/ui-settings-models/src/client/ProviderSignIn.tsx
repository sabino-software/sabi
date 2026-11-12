/** Provider-owned sign-in conversations, presented within Models settings. */
import { useId, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AuthorizationFrame, AuthorizationPromptId, ClientProviderAuthorization,
} from '@deepseek-ai/dsh-api-authorization-controller/client'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'
import authStyles from './ProviderSignIn.module.css'

/** Plain commands and renderer-bound redacted state. */
export interface ProviderSignInInjected {
  hooks: { authorization: ClientProviderAuthorization['state'] }
  load(): Promise<void>
  begin(key: CredentialKey, method: string): void
  answer(id: AuthorizationPromptId, value: string): Promise<void>
  cancel(): Promise<void>
  logout(key: CredentialKey): Promise<void>
  t(key: keyof typeof en): string
}

/** Return only browser-safe external destinations. */
function externalUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch (_error) {
    return undefined
  }
}

/** One unanswered question; its capability owns the draft lifetime. */
function Question({ prompt, answer, pending, t }: {
  prompt: NonNullable<AuthorizationFrame['prompt']>
  answer: ProviderSignInInjected['answer']
  pending: boolean
  t: ProviderSignInInjected['t']
}): ReactNode {
  const id = useId()
  const question = prompt.question
  const [value, setValue] = useState(question.kind === 'select' ? question.options[0]?.id ?? '' : '')
  return (
    <form className={authStyles['question']} onSubmit={event => {
      event.preventDefault()
      if (value.length === 0 || pending) return
      const submitted = value
      setValue('')
      void answer(prompt.id, submitted)
    }}>
      <label htmlFor={id}>{question.message}</label>
      {question.kind === 'select'
        ? <select id={id} className={authStyles['input']} value={value} disabled={pending}
          onChange={event => { setValue(event.target.value) }}>
          {question.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        : <input id={id} className={authStyles['input']} type={question.kind === 'secret' ? 'password' : 'text'}
          autoComplete="off" spellCheck={false} value={value} placeholder={question.placeholder}
          disabled={pending} onChange={event => { setValue(event.target.value) }} />}
      <Button type="submit" variant="filled" size="sm" disabled={pending || value.length === 0}>{t('authContinue')}</Button>
    </form>
  )
}

/**
 * Render registered OAuth flows with app-owned stored state, notices, prompts, cancellation, and logout.
 * @param props - renderer-bound sign-in state and commands.
 * @returns the Models sign-in area.
 */
export function ProviderSignIn(props: InjectFace<ProviderSignInInjected>): ReactNode {
  const { t, load, begin, answer, cancel, logout } = props
  const state = props.useAuthorization(value => value)
  const [removing, setRemoving] = useState<CredentialKey | undefined>()
  const flows = state.entries.filter(entry => entry.methods.some(method => method.id === 'oauth'))
  const active = state.active
  const running = active !== null && (active.frame === undefined || active.frame.status === 'running')
  const removal = flows.find(entry => entry.key === removing)
  if (state.status === 'idle') void load()
  if (state.status === 'ready' && flows.length === 0) return null
  return (
    <section className={authStyles['section']} aria-label={t('authTitle')}>
      <h3 className={styles['title']}>{t('authTitle')}</h3>
      <p className={styles['intro']}>{t('authDescription')}</p>
      {state.error !== null && <p className={styles['error']} role="alert">{t(
        state.error === 'load' ? 'authLoadFailed' : state.error === 'answer' ? 'authAnswerFailed'
          : state.error === 'logout' ? 'authLogoutFailed' : 'authInterrupted',
      )}</p>}
      {(state.status === 'error' || state.error === 'interrupted')
        && <Button variant="outlined" size="sm" onClick={() => { void load() }}>{t('retry')}</Button>}
      <ul className={authStyles['flows']}>
        {flows.map(entry => {
          const current = active?.key === entry.key ? active.frame : undefined
          const notice = current?.status === 'running' ? current.notice : undefined
          const url = externalUrl(notice?.url)
          return (
            <li className={styles['rowCard']} key={entry.key}>
              <div className={authStyles['head']}>
                <span className={styles['rowName']}>{entry.label}</span>
                <span className={styles['intro']}>{entry.configured ? t('authStored') : t('authNotStored')}</span>
                <div className={authStyles['actions']}>
                  {entry.methods.filter(method => method.id === 'oauth').map(method =>
                    <Button key={method.id} variant="outlined" size="sm"
                      disabled={running || state.pending || entry.inFlight || !entry.writable || state.status !== 'ready'}
                      onClick={() => { begin(entry.key, method.id) }}>{method.label}</Button>)}
                  {entry.configured && <Button variant="outlined" size="sm"
                    disabled={running || state.pending || entry.inFlight || !entry.writable}
                    onClick={() => { setRemoving(entry.key) }}>{t('authSignOut')}</Button>}
                </div>
              </div>
              {active?.key === entry.key && <div className={authStyles['interaction']} aria-live="polite">
                <p className={styles['intro']}>{t(current === undefined || current.status === 'running' ? 'authWaiting'
                  : current.status === 'authorized' ? 'authSuccess' : current.status === 'cancelled' ? 'authCancelled' : 'authFailed')}</p>
                {notice !== undefined && <p className={authStyles['notice']}>{notice.message}</p>}
                {url !== undefined && <a href={url} target="_blank" rel="noopener noreferrer">{t('authOpenBrowser')}</a>}
                {notice?.code !== undefined && <code className={authStyles['code']}>{notice.code}</code>}
                {current?.prompt !== undefined && <Question key={current.prompt.id} prompt={current.prompt}
                  answer={answer} pending={state.pending} t={t} />}
                {running && <Button variant="outlined" size="sm" disabled={state.pending}
                  onClick={() => { void cancel() }}>{t('cancel')}</Button>}
              </div>}
              {entry.inFlight && active?.key !== entry.key && <p className={styles['intro']}>{t('authElsewhere')}</p>}
            </li>
          )
        })}
      </ul>
      <Modal open={removal !== undefined} onClose={() => { if (!state.pending) setRemoving(undefined) }}
        closeLabel={t('close')} title={t('authSignOutTitle')} description={t('authSignOutDescription').replace('{provider}', removal?.label ?? '')}
        footer={<>
          <Button variant="outlined" size="sm" disabled={state.pending} onClick={() => { setRemoving(undefined) }}>{t('cancel')}</Button>
          <Button variant="filled" size="sm" disabled={state.pending} onClick={() => {
            if (removing === undefined) return
            void logout(removing).then(() => { setRemoving(undefined) })
          }}>{t('authSignOut')}</Button>
        </>} />
    </section>
  )
}
