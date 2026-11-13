/** Response-only chrome for an owned original-site window; never exposed to its website document. */
export const AXIOM_WINDOW_PAGE = 'dsh-app://shell/axiom-window.html'
/** Fixed chrome messages are authenticated by their exact owning main frame. */
export const AXIOM_WINDOW_IPC = { command: 'dsh-axiom-window:command', labels: 'dsh-axiom-window:labels' } as const
/** Localized labels contain no page URL, login state, or original conversation content. */
export interface AxiomWindowLabels { readonly title: string; readonly reload: string; readonly close: string }
/** Only fixed actions on the window carrying this chrome can be requested. */
export interface AxiomWindowApi {
  reload(): void
  close(): void
  subscribe(listener: (labels: AxiomWindowLabels) => void): () => void
}
