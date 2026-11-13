---
description: "Continue original work Codex and ChatGPT Dot conversations through ordinary Harness Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-conversations

English | [中文](README.zh.md)

## Summary

Continue original work Codex and selected ChatGPT Dot conversations from the ordinary Harness sidebar, transcript, and composer. Source badges identify the original conversation. Inference and source history remain with the original application and account.

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

Open **Native conversations** to refresh Codex metadata. Enable Dot and its sidebar option in General Settings to place **Dot** directly below New Session. The Dot action reuses an existing selection or lets the user sign in and choose on the original website; it never asks for a URL. Codex synchronization also runs when the service starts. Source identities map to stable local Session IDs, so refresh attaches existing rows instead of importing the same conversation again. Source user and assistant text is hydrated when its Agent opens, with original message IDs retained in ingestion checkpoints. Historical operations render as inert source activity cards. An idle open Codex chat also refreshes completed source turns without starting inference.

Codex uses the connected work daemon, independently of the personal Codex home. A direct text or image turn resumes the bound original thread or starts a thread for a new native Codex Session. It refuses an original thread with an unfinished turn in another client. Harness exposes the current Agent's declared tools through a temporary authenticated loopback MCP endpoint, dispatching calls through its existing execution and approval services. Cancellation interrupts only the exact turn acknowledged for that operation; it does not stop unrelated Codex work.

Axiom uses the desktop-owned original ChatGPT page. Sign in directly through **Open ChatGPT login** when needed; cookies and token storage stay in that dedicated Electron session. In-app sign-in needs no browser extension. The optional regular-browser companion discovers only the explicitly paired Dot when that connection is selected. Website windows provide Reload and Close controls; Close destroys their content and stops observation until an explicit Dot action reopens it, preserving website login storage. The adapter sends only the exact user-composed text through the original website's composer and observes new original assistant message IDs. It never calls a ChatGPT model API or creates an imitation Dot. Refused or uncertain submissions are not retried automatically. Canceling Harness observation does not click an unobserved website Stop control.

<a id="configure-the-service"></a>
## Configure the service

| Field | Default | Purpose |
| --- | --- | --- |
| `fallbackCwd` | OS home plus `Documents/deepseek-harness-default-workspace` | Workspace when a source directory is unavailable. |
| `codexPollIntervalMs` | `2000` | Completed source-turn observation interval for idle Codex chats. |
| `codexLoginTimeoutMs` | `300000` | Maximum wait for the managed Codex browser callback. |
| `codexLoginCancelTimeoutMs` | `5000` | Deadline for cancelling this app’s exact pending Codex login. |
| `axiomRequestTimeoutMs` | `30000` | Desktop page operation deadline. |
| `axiomPollIntervalMs` | `750` | Original-page observation interval. |
| `axiomResponseTimeoutMs` | `300000` | Maximum acknowledged-send operation lifetime. |
| `axiomSettleMs` | `1500` | Fallback stream adapter settling interval; the desktop uses continuous source observation instead. |

The owner-only Remote surface contains `status`, `syncCodex`, `connectAxiom`, `showAxiomLogin`, and `useCodex`. The welcome action selects the already authenticated work subscription without creating or copying a grant. The Session projection `nativeConversation` identifies its source; source message checkpoints prevent duplicate ingestion. See the [session-query subsystem reference](../../../docs/subsystems/session-query.md) for the surrounding conversation services.

<a id="model-experience"></a>
## Model Experience

### Native source turns

#### What the model sees

Codex retains its original thread. `turn/start` receives direct user text and admitted images, while `mcp_servers.skeinlet` exposes the current step's Harness tool declarations. The original Dot receives the user text through its website. Connection metadata and source URLs do not become extra persona instructions.

#### Token effect

Native turns use the original Codex or ChatGPT account. Metadata synchronization and history hydration do not generate model replies. Harness tool schemas, instructions, and tool results may add input to a Codex turn.

#### KV Cache effect

The original service owns cache behavior. Keeping the source conversation does not guarantee cache reuse; changes to the declared Harness tools or instructions may affect it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Original services must be running and authenticated. Website DOM or authentication changes can make Axiom unavailable.
- Axiom history contains only the bounded rendered page window, with truncation reported. It does not include unloaded or virtualized history.
- Direct OpenAI login is supported. External social or enterprise identity-provider navigation requires an admitted destination.
- Copied or forked Harness Sessions are not silently rebound to the original source. Create a fork in the source application before continuing that copy.
- Native adapters reject auxiliary title and compaction requests. Axiom accepts text only; its bridge does not replay historical tools, fetch images automatically, or expose arbitrary website interactions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
