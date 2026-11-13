/** Dot navigation and General Settings use the shared accepted preferences. */
import { useState } from 'react'
import { IconLayersOutlineRegular, Switch, Tooltip, Menu, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DotState } from './dot-controller.ts'
import type { DotPreferences, DotSidebarStyle } from './desktop-axiom.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import css from './page.module.css'

/** Shared interaction source and explicit user callbacks. */
export interface DotControlsInjected {
  hooks: { dot: ObservableSnapshot<DotState> }
  chooseDot(): Promise<void>
  setDotPreferences(preferences: DotPreferences): Promise<void>
}

/** Dedicated Dot action below New Session, including while website sign-in is needed. */
export function DotSidebarRow({
  wide, buttonClasses, labelMaskClassName, contentClassName, labelClassName, iconSize, useDot, chooseDot, t,
}:
  PropsRuntime<'sidebar.primary.action'> & PropsLocale<'codexLibrary'> & InjectFace<DotControlsInjected>) {
  const state = useDot(value => value)
  if (!state.preferences?.enabled || !state.preferences.showInSidebar) return null
  return <Tooltip label={t('dot')} disabled={wide}>
    <button className={buttonClasses[state.preferences.sidebarStyle]} data-wide={wide} type="button"
      aria-label={t('dot')} disabled={state.busy}
      onClick={() => { void chooseDot() }}>
      <span className={labelMaskClassName}><span className={contentClassName}>
        <IconLayersOutlineRegular size={iconSize} />{wide && <span className={labelClassName}>{t('dot')}</span>}
      </span></span>
    </button>
  </Tooltip>
}

/** Independent persisted integration and sidebar toggles. */
export function DotSettingsRow({ useDot, setDotPreferences, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'codexLibrary'> & InjectFace<DotControlsInjected>) {
  const { preferences, preferencesFailed } = useDot(value => value)
  const [busy, setBusy] = useState(false)
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
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
    <div className={css.preferenceRow}>
      <span>{t('dotSidebarStyle')}</span>
      <Menu open={styleMenuOpen} onClose={() => { setStyleMenuOpen(false) }} portal align="end"
        selectedId={preferences?.sidebarStyle ?? 'sameNewSession'}
        items={(['sameNewSession', 'subtle', 'outline'] as const).map(id => ({ id, label: styleLabel(id, t) }))}
        onSelect={(id) => {
          setStyleMenuOpen(false)
          if (preferences !== null && (id === 'sameNewSession' || id === 'subtle' || id === 'outline')) {
            save({ ...preferences, sidebarStyle: id })
          }
        }}
        anchor={<Button type="button" size="sm" variant="outline" disabled={busy || preferences === null}
          aria-label={t('dotSidebarStyle')} aria-haspopup="menu" aria-expanded={styleMenuOpen}
          onClick={() => { setStyleMenuOpen(!styleMenuOpen) }}>
          {styleLabel(preferences?.sidebarStyle ?? 'sameNewSession', t)}
        </Button>} />
    </div>
    {(preferencesFailed || saveFailed) && <p role="alert">{t('dotPreferencesError')}</p>}
  </div>
}

/** Localized labels for the closed appearance choices. */
function styleLabel(style: DotSidebarStyle, t: PropsLocale<'codexLibrary'>['t']): string {
  return t(style === 'sameNewSession' ? 'dotStyleMatch' : style === 'subtle' ? 'dotStyleSubtle' : 'dotStyleOutline')
}
