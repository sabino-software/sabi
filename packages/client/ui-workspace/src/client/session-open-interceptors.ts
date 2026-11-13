/** Generic external-view interception before a Session acquires its main-view reference. */
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'

/** Return true to consume a legacy Session address without retaining or activating its transcript. */
export type SessionOpenInterceptor = (target: SessionTarget, signal: AbortSignal) => boolean | Promise<boolean>

/** Navigation owns cancellation; feature registrations own their routing decisions and lifetime. */
export class SessionOpenInterceptors {
  private readonly handlers = new Set<SessionOpenInterceptor>()
  /**
   * Register one feature's pre-retain route decision.
   * @param handler Feature-owned route decision.
   * @returns Its registration disposer.
   */
  register(handler: SessionOpenInterceptor): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }
  /**
   * Read whether Session addresses require feature inspection before opening.
   * @returns Whether any interception is registered.
   */
  get registered(): boolean { return this.handlers.size > 0 }
  /**
   * Inspect addresses before any Session retain, stopping on cancellation or a consumed route.
   * @param target Original Session or subagent address.
   * @param signal Navigation lifetime.
   * @returns True for consumed or cancelled navigation; false permits normal Session opening.
   */
  inspect(target: SessionTarget, signal: AbortSignal): boolean | Promise<boolean> {
    const handlers = [...this.handlers]
    const next = (index: number): boolean | Promise<boolean> => {
      if (signal.aborted) return true
      const handler = handlers[index]
      if (handler === undefined) return false
      const result = handler(target, signal)
      return typeof result === 'boolean' ? result || next(index + 1)
        : result.then(consumed => consumed || next(index + 1))
    }
    return next(0)
  }
}
