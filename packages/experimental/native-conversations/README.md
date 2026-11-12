---
description: "Continue original work Codex and ChatGPT Dot conversations through ordinary Harness Sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-native-conversations

English | [中文](README.zh.md)

## Summary

The `ctx.nativeConversations` service binds ordinary Harness Sessions to original Codex threads or a selected ChatGPT Dot page. The standard workspace sidebar, conversation transcript, and composer remain the interaction surface; source badges identify the original conversation. Native inference runs at its original source rather than through a replacement persona or a second model provider account.

## Use this package

The isolated desktop fork enables this service with `DSH_NATIVE_CONVERSATIONS=1`. Default Web composition leaves it disabled. Mount it after the Session, persistence, workspace, Agent, model, tool, sandbox, and approval services, alongside [`dsh-host-codex-app-server`](../../host/codex-app-server/README.md). The desktop Host attaches the original-page transport with `attachAxiomTransport`; browser code cannot supply that transport.

Open **Native conversations** to refresh Codex metadata or connect an existing ChatGPT Dot URL. Codex synchronization also runs when the service starts. Source identities map to stable local Session IDs, so refresh attaches existing rows instead of importing the same conversation again. Source user and assistant text is hydrated when its Agent opens, with original message IDs retained in ingestion checkpoints. Historical tools and model executions are not fabricated.

Codex uses the connected work daemon, independently of the personal Codex home. A direct text turn resumes the bound original thread or starts a thread for a new native Codex Session. It refuses an original thread with an unfinished turn in another client. Harness exposes the current Agent's declared tools through a temporary authenticated loopback MCP endpoint, dispatching calls through its existing execution and approval services. Cancellation interrupts only the exact turn acknowledged for that operation; it does not stop unrelated Codex work.

Axiom uses the desktop-owned original ChatGPT page. Sign in directly through **Open ChatGPT login** when needed; cookies and token storage stay in that dedicated Electron session. The adapter sends only the exact user-composed text through the original website's composer and observes new original assistant message IDs. It never calls a ChatGPT model API or creates an imitation Dot. Refused or uncertain submissions are not retried automatically. Canceling Harness observation does not click an unobserved website Stop control.

## Configure the service

| Field | Default | Purpose |
| --- | --- | --- |
| `fallbackCwd` | OS home plus `Documents/deepseek-harness-default-workspace` | Workspace when a source directory is unavailable. |
| `axiomRequestTimeoutMs` | `30000` | Desktop page operation deadline. |
| `axiomPollIntervalMs` | `750` | Original-page observation interval. |
| `axiomResponseTimeoutMs` | `300000` | Maximum response observation time. |
| `axiomSettleMs` | `1500` | Stable text and idle-page interval before completion. |

The owner-only Remote surface contains `status`, `syncCodex`, `connectAxiom`, and `showAxiomLogin`. The Session projection `nativeConversation` identifies its source; source message checkpoints prevent duplicate ingestion. See the [session-query subsystem reference](../../../docs/subsystems/session-query.md) for the surrounding conversation services.

## Model Experience

### Native source turns

#### What the model sees

Codex retains its original thread and receives the direct user text plus the current step's Harness tool declarations through MCP. The original Dot receives the user text through its website. Connection metadata and source URLs do not become extra persona instructions.

#### Token effect

Native turns use the original Codex or ChatGPT account. Metadata synchronization and history hydration do not generate model replies. Harness tool schemas, instructions, and tool results may add input to a Codex turn.

#### KV Cache effect

The original service owns cache behavior. Keeping the source conversation does not guarantee cache reuse; changes to the declared Harness tools or instructions may affect it.

## Known Limitations and Deferred Work

Original services must be running and authenticated. Axiom history is the bounded rendered page window, including its truncation indication, rather than a claim of complete virtualized history. Website DOM or authentication changes can make its adapter unavailable. Its text-first bridge does not replay historical tools, automatically fetch images, or expose arbitrary website interactions. Live sign-in, original-source continuity, and end-to-end tool execution require runtime verification beyond package installation or source fixtures.
