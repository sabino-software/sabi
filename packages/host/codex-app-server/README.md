---
description: "Native Host connection to the existing work Codex daemon."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-codex-app-server

English | [中文](README.zh.md)

## Summary

Connect to the running work Codex application to list original chats, read their history, and send authorized turns. Consumers can handle native approval and question requests while retaining original thread IDs. The daemon must already be running; this package does not create Harness Sessions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Load the Host plugin and call `connect()` or `request(method, params, signal?)`. `sourceHome` defaults to the OS user's `.codex`, independently of `CODEX_HOME`; `socketPath` defaults to that home's `app-server-control/app-server-control.sock`. Initialization verifies the daemon's reported home before permitting thread operations. The transport never reads auth or config files, starts or restarts a daemon, or accesses a personal Codex home.

Managed browser sign-in is available through `account/login/start` with `type: "chatgpt"` and exact-login cancellation through `account/login/cancel`. The daemon supplies the authorization URL, hosts the localhost callback, and owns credential persistence. Consumers open the link only after an explicit user action, match completion by login ID, and verify `account/read`. They do not capture tokens or create a second callback server. This authorization serves Codex; it does not expose ChatGPT web conversation history or share the browser’s website session.

`request` accepts only the declared catalog, history, model, thread, and turn operations. Parameters and results retain official field names. Consumers own method-specific validation, authorization, Session projection, and pagination. Use `thread/list.useStateDbOnly: true` when browsing should avoid upstream metadata repair. Use `thread/resume.excludeTurns: true` and the history pagination methods.

`onNotification` and `onStatus` are disposable subscriptions. `setRequestHandler` assigns one owner for an approval, question, elicitation, or dynamic tool method. Handlers receive the original request ID, connection generation, and an abort signal. Resolved requests, finished turns, connection loss, and disposal cancel pending handlers; late answers are not transmitted. Missing handlers cancel approvals, deny permissions, dismiss questions, or report unavailable tools.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

One connection performs `initialize` then `initialized`. Frames, output queues, and concurrent requests have complete bounds. Requests have deadlines; a lost, cancelled, or timed-out submitted mutation reports `outcomeUnknown` and is never automatically replayed. A later explicit request may reconnect, but the consumer must restore subscriptions and read current history first. Disposal closes only owned WebSocket connections and waits for them to close; it never sends turn interruption or daemon-control commands.

The [official protocol](https://learn.chatgpt.com/docs/app-server) and generated CLI 0.167.1 types define the supported messages. Unix sockets require a WebSocket upgrade. `codex app-server proxy` forwards bytes and does not convert JSONL to WebSocket frames. The existing `ws` dependency owns framing, payload bounds, and the Unix HTTP upgrade.

</details>

<a id="model-experience"></a>
## Model Experience

### Native requests

#### What the model sees

`turn/start` and `turn/steer` forward explicitly authorized input to the original Codex conversation. A consumer's tool bridge returns model-visible tool output; this transport adds no hidden instructions.

#### Token effect

Catalog and history reads make no model request. The native daemon owns model selection, token accounting, and the original conversation history for generation requests.

#### KV Cache effect

The native daemon owns prompt construction and its cache. The transport does not reconstruct source prompts or guarantee cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The service requires an already-running Unix app-server. It does not start a daemon, discover supervisors, or support remote TCP endpoints.
- Protocol fields follow the installed Codex version. Resuming a thread does not establish ownership of an active turn held by another client.
- `dynamicTools` is available only on `thread/start`, not `thread/resume` or `turn/start`. The native conversation service supplies Harness tools through its separately owned MCP bridge.
- Consumers must obey handler cancellation and display unknown outcomes before offering a retry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
