/** Dot navigation and General Settings use the shared accepted preferences. */
import { useState } from 'react'
import { IconLayersOutlineRegular, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DotState } from './dot-controller.ts'
import type { DotPreferences } from './desktop-axiom.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import css from './page.module.css'

/** Shared interaction source and explicit user callbacks. */
export interface DotControlsInjected {
  hooks: { dot: ObservableSnapshot<DotState> }
  chooseDot(): Promise<void>
  setDotPreferences(preferences: DotPreferences): Promise<void>
}

/** Dedicated Dot action below New Session, including while website sign-in is needed. */
export function DotSidebarRow({ wide, useDot, chooseDot, t }:
  PropsRuntime<'sidebar.primary.action'> & PropsLocale<'codexLibrary'> & InjectFace<DotControlsInjected>) {
  const state = useDot(value => value)
  if (!state.preferences?.enabled || !state.preferences.showInSidebar) return null
  return <Tooltip label={t('dot')} disabled={wide}>
    <button className={css.dotAction} data-wide={wide} type="button" aria-label={t('dot')} disabled={state.busy}
      onClick={() => { void chooseDot() }}>
      <IconLayersOutlineRegular size={wide ? 14 : 18} />{wide && <span>{t('dot')}</span>}
    </button>
  </Tooltip>
}

/** Independent persisted integration and sidebar toggles. */
export function DotSettingsRow({ useDot, setDotPreferences, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'codexLibrary'> & InjectFace<DotControlsInjected>) {
  const { preferences, preferencesFailed } = useDot(value => value)
  const [busy, setBusy] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const save = (next: DotPreferences): void => {
    setBusy(true); setSaveFailed(false)
    void setDotPreferences(next).catch(() => { setSaveFailed(true) }).finally(() => { setBusy(false) })
  }
  return <div>
    {(['enabled', 'showInSidebar'] as const).map(key => <div className={css.preferenceRow} key={key}>
      <span>{t(key === 'enabled' ? 'dotEnabled' : 'dotShowInSidebar')}</span>
      <Switch label={t(key === 'enabled' ? 'dotEnabled' : 'dotShowInSidebar')} checked={preferences?.[key] ?? false}
        disabled={busy || preferences === null}
        onChange={(value) => { if (preferences !== null) save({ ...preferences, [key]: value }) }} />
    </div>)}
    {(preferencesFailed || saveFailed) && <p role="alert">{t('dotPreferencesError')}</p>}
  </div>
}
