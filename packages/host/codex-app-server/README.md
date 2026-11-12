---
description: "Native Host connection to the existing work Codex daemon."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-codex-app-server

English | [中文](README.zh.md)

## Summary

`ctx.codexAppServer` connects to an existing work Codex daemon through its official Unix WebSocket transport. It preserves original thread IDs, paginated history, runtime notifications, turn controls, and server requests. It does not create Harness Sessions or start a daemon.

## Use this package

Load the Host plugin and call `connect()` or `request(method, params, signal?)`. `sourceHome` defaults to the OS user's `.codex`, independently of `CODEX_HOME`; `socketPath` defaults to that home's `app-server-control/app-server-control.sock`. Initialization verifies the daemon's reported home before permitting thread operations. The transport never reads auth or config files, starts or restarts a daemon, or accesses a personal Codex home.

`request` accepts only the declared catalog, history, model, thread, and turn operations. Parameters and results retain official field names. Consumers own method-specific validation, authorization, Session projection, and pagination. Use `thread/list.useStateDbOnly: true` when browsing should avoid upstream metadata repair. Use `thread/resume.excludeTurns: true` and the history pagination methods.

`onNotification` and `onStatus` are disposable subscriptions. `setRequestHandler` assigns one owner for an approval, question, elicitation, or dynamic tool method. Handlers receive the original request ID, connection generation, and an abort signal. Resolved requests, finished turns, connection loss, and disposal cancel pending handlers; late answers are not transmitted. Missing handlers cancel approvals, deny permissions, dismiss questions, or report unavailable tools.

## Understand the implementation

One connection performs `initialize` then `initialized`. Frames, output queues, and concurrent requests have complete bounds. Requests have deadlines; a lost, cancelled, or timed-out submitted mutation reports `outcomeUnknown` and is never automatically replayed. A later explicit request may reconnect, but the consumer must restore subscriptions and read current history first. Disposal closes only owned WebSocket connections and waits for them to close; it never sends turn interruption or daemon-control commands.

The [official protocol](https://learn.chatgpt.com/docs/app-server) and generated CLI 0.167.1 types define the supported messages. Unix sockets require a WebSocket upgrade. `codex app-server proxy` forwards bytes and does not convert JSONL to WebSocket frames. The existing `ws` dependency owns framing, payload bounds, and the Unix HTTP upgrade.

## Model Experience

Catalog and history reads make no model request. `turn/start` and `turn/steer` forward explicitly authorized model input to Codex; the native daemon owns model selection, token accounting, and its original conversation history. A tool bridge's returned output becomes native model-visible tool output.

### KV-cache effect

The native daemon owns prompt construction and its cache. The transport neither reconstructs source prompts nor adds hidden instructions.

## Known Limitations and Deferred Work

The service requires an already-running Unix app-server. It does not bootstrap, discover supervisors, or support remote TCP endpoints. Protocol fields follow installed Codex versions. Existing active turns owned by another client need separate acceptance testing before assuming request ownership transfers on resume. `dynamicTools` is available only on `thread/start`, not `thread/resume` or `turn/start`; adding Harness tools to an existing chat requires an independently verified MCP bridge. Consumers must obey handler cancellation and display unknown outcomes before offering a retry.
