---
description: "Continue work Codex Sessions and retain compatibility metadata for the dedicated Dot view."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-conversations

English | [中文](README.zh.md)

## Summary

Continue original work Codex conversations through ordinary Harness Sessions. Dot uses its dedicated desktop view; legacy Axiom mirrors are hidden without deleting their logs.

## Table of Contents

- [Use this package](#use-this-package)
- [Configure the service](#configure-the-service)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The isolated desktop fork enables this service with `DSH_NATIVE_CONVERSATIONS=1`. Default Web composition leaves it disabled. Mount it after the Session, projection cache, Session Controller, title, storage-domain, persistence, workspace, Agent, model, tool, sandbox, and approval services, alongside [`dsh-host-codex-app-server`](../../host/codex-app-server/README.md). The desktop Host attaches the original-page transport with `attachAxiomTransport`; browser code cannot supply that transport.

A signed-out work account can sign in through the native connection panel using the regular browser. The explicit managed login uses `account/login/start`; Codex owns its localhost callback and credentials. The service matches the login ID and connection generation, verifies `account/read`, and then selects the work model and refreshes source metadata. Status contains no authorization URL or credentials. Cancellation targets only the pending login created by this service. Existing signed-in accounts are preserved; Codex authorization does not grant ChatGPT conversation history or authenticate Axiom’s website session.

Open **Native conversations** to refresh work Codex metadata. Synchronization attaches original Codex threads to stable Harness Session IDs and hydrates source messages only when opened. Dot does not participate in this import.

Codex uses the connected work daemon, independently of the personal Codex home. A direct text or image turn resumes the bound original thread or starts a thread for a new native Codex Session. It refuses an original thread with an unfinished turn in another client. Harness exposes the current Agent's declared tools through a temporary authenticated loopback MCP endpoint, dispatching calls through its existing execution and approval services. Cancellation interrupts only the exact turn acknowledged for that operation; it does not stop unrelated Codex work.

Dot is a dedicated continuous view opened from the top Dot button, not a Harness Session or an LLM provider. Its trusted desktop page bridge owns selection, website authentication, snapshots and sends. Existing Axiom mirror logs and their persisted readers remain intact. Their presentation policy hides them from normal Session discovery and refuses ordinary opening; saved identities redirect to the dedicated Dot view. The deprecated `connectAxiom(url)` selects the original page and returns `{ url, phase }`, never a Session id.

Unreadable cold Session bodies do not block sidebar or workspace discovery: unclassified histories retain their ordinary header listing without repair or activation. A known cached Dot identity stays hidden even when stale or corrupt. Failed body classification is memoized by revision; cancellation still propagates.

<a id="configure-the-service"></a>
## Configure the service

| Field | Default | Purpose |
| --- | --- | --- |
| `fallbackCwd` | OS home plus `Documents/deepseek-harness-default-workspace` | Workspace when a source directory is unavailable. |
| `codexPollIntervalMs` | `2000` | Completed source-turn observation interval for idle Codex chats. |
| `codexLoginTimeoutMs` | `300000` | Maximum wait for the managed Codex browser callback. |
| `codexLoginCancelTimeoutMs` | `5000` | Deadline for cancelling this app’s exact pending Codex login. |
| `axiomRequestTimeoutMs` | `30000` | Desktop page operation deadline. |
| `axiomPollIntervalMs` | `750` | Legacy compatibility field; unused by the dedicated Dot surface. |
| `axiomResponseTimeoutMs` | `300000` | Legacy compatibility field; unused by the dedicated Dot surface. |
| `axiomSettleMs` | `1500` | Legacy compatibility field; unused by the dedicated Dot surface. |

The owner-only Remote surface contains `status`, `syncCodex`, `connectAxiom`, `showAxiomLogin`, and `useCodex`. The welcome action selects the already authenticated work subscription without creating or copying a grant. The Session projection `nativeConversation` identifies its source; source message checkpoints prevent duplicate ingestion. See the [session-query subsystem reference](../../../docs/subsystems/session-query.md) for the surrounding conversation services.

<a id="model-experience"></a>
## Model Experience

### Native source turns

#### What the model sees

Codex retains its original thread. `turn/start` receives direct user text and admitted images, while `mcp_servers.skeinlet` exposes the current step's Harness tool declarations. The original Dot receives the user text through its website. Connection metadata and source URLs do not become extra persona instructions.

#### Token effect

Codex turns use the original Codex account. Dot does not run Harness model turns. Metadata reads and Codex history hydration do not generate model replies; Harness tool schemas and results may add input to Codex.

#### KV Cache effect

The original service owns cache behavior. Keeping the source conversation does not guarantee cache reuse; changes to the declared Harness tools or instructions may affect it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Original services must be running and authenticated. Website DOM or authentication changes can make Axiom unavailable.
- Axiom history contains only the bounded rendered page window, with truncation reported. It does not include unloaded or virtualized history.
- Direct OpenAI login is supported. External social or enterprise identity-provider navigation requires an admitted destination.
- Copied or forked Harness Sessions are not silently rebound to the original source. Create a fork in the source application before continuing that copy.
- Codex rejects auxiliary title and compaction requests. Dot sends belong to the dedicated website bridge, not the Harness model loop.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
