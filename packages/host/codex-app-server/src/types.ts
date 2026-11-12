/** Host-facing JSON-RPC values and connection facts for the native Codex daemon. */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Official protocol fields are preserved rather than projected into Harness Sessions here. */
export type CodexJsonObject = { [key: string]: JsonValue }

/** The native operations currently consumed by the coding workspace. */
export type CodexMethod =
  | 'thread/list' | 'thread/read' | 'thread/turns/list' | 'thread/items/list' | 'thread/loaded/list'
  | 'model/list' | 'permissionProfile/list' | 'mcpServerStatus/list'
  | 'thread/start' | 'thread/resume' | 'thread/unsubscribe'
  | 'thread/name/set' | 'thread/archive' | 'thread/unarchive' | 'thread/settings/update'
  | 'turn/start' | 'turn/steer' | 'turn/interrupt'

/** Server requests that can be routed into Harness approvals, questions, and tools. */
export type CodexServerRequestMethod =
  | 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval'
  | 'item/permissions/requestApproval' | 'item/tool/requestUserInput'
  | 'mcpServer/elicitation/request' | 'item/tool/call'
  | 'applyPatchApproval' | 'execCommandApproval' | 'currentTime/read'

/** Original server correlation identity, echoed unchanged on the wire. */
export type CodexRequestId = string | number

/** The current transport generation; ready means initialized, not model access verified. */
export interface CodexConnectionStatus {
  readonly state: 'disconnected' | 'connecting' | 'ready' | 'disposed'
  readonly generation: number
  readonly sourceHome: string
  readonly reason: 'unavailable' | 'lost' | 'protocol' | null
}

/** An unprojected daemon notification, including runtime status and incremental turn items. */
export interface CodexNotification {
  readonly generation: number
  readonly method: string
  readonly params: CodexJsonObject
}

/** One server request's lifetime; handlers must stop side effects when aborted. */
export interface CodexServerRequestContext {
  readonly id: CodexRequestId
  readonly generation: number
  readonly method: CodexServerRequestMethod
  readonly signal: AbortSignal
}

/** A handler must return the official method's response object, without logging private payloads. */
export type CodexServerRequestHandler = (
  params: CodexJsonObject,
  context: CodexServerRequestContext,
) => Promise<CodexJsonObject>

/** Machine-routable failures without daemon error text or transcript contents. */
export type CodexAppServerErrorCode =
  | 'CODEX_UNAVAILABLE' | 'CODEX_DISCONNECTED' | 'CODEX_PROTOCOL' | 'CODEX_LIMIT'
  | 'CODEX_CANCELLED' | 'CODEX_TIMEOUT' | 'CODEX_RPC_REJECTED' | 'CODEX_DISPOSED'
  | 'CODEX_METHOD_UNSUPPORTED' | 'CODEX_HANDLER_EXISTS' | 'CODEX_WRONG_HOME'
