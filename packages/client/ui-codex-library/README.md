---
kind: package-reference
description: "Continue work Codex Sessions and the separate continuous original Dot conversation."
---

# @deepseek-ai/dsh-client-ui-codex-library

English | [中文](README.zh.md)

## Summary

Work Codex conversations remain ordinary Harness Sessions in their workspaces, with their existing tools, approvals, source badges, and composer. Dot is a separate continuous original-site conversation, opened only by its top sidebar button. It is never a regular Session, sidebar history item, or chat launcher.

## Table of Contents

- [Use this package](#use)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use"></a>
## Use this package

Mount this UI beside the [native conversation service](../../experimental/native-conversations/README.md), standard Session and Workspace services, and resource registry. The **Native conversations** panel configures connections and syncs existing work Codex threads. Work Codex sign-in, selecting its subscription for future chats, native tools, permissions, and approval routing retain their ordinary owners.

In **Settings → General**, **Enable Dot integration** and **Show Dot in sidebar** are independent saved options. With both enabled and the installed native integration available, the dedicated button appears directly below **New Session**. It uses the actual selected title, such as **Axiom**, with **Dot** as its unselected fallback. **Dot button style** offers Match New Session, Subtle, and Outline with the same shared geometry. The integration defaults to enabled and sidebar visibility to off; existing private preferences without a style field load Match New Session without being rewritten.

Only that top button opens the dedicated Dot view. **Connect Dot** in the connection panel configures the original website without navigating to the view or creating a Session. In-app ChatGPT sign-in is primary and persists with its dedicated website session; the [regular-browser companion](../../../docs/fork-release/axiom-browser-bridge.md) is optional. Opening settings preserves the selected transport. Codex sign-in does not authenticate the ChatGPT website.

The dedicated view reads validated snapshots and source events directly from the trusted desktop bridge and sends exact user-authored text through its original composer. It creates no Host Agent, Harness Session, or LLM turn for Dot. Messages keep original source IDs and DOM chronology; autonomous replies are independent messages rather than alternating local turns. Older pages prepend with deduplication and an original-ID viewport anchor retained through variable-height Markdown measurement. The timeline is virtualized with no client total-message cap. A missing or timed-out older-history capability reports unavailable with explicit retry, never fabricated history exhaustion.

The Dot-specific view uses the original website's dark background, typography, gray and purple bubbles, date dividers, and rounded composer. Automatic follow stays at the bottom only while the user is there; initial estimated scrolling cannot request older pages. Failed or unknown submissions retain the authored draft and are never automatically retried or represented by invented source messages.

The original connected page runs hidden to power the dedicated conversation. **Open ChatGPT** reveals it for direct interaction. Explicitly closing that page disconnects it until another top-button selection. Disabling the integration revokes source access. Legacy Axiom Session logs remain preserved, but their summaries and search results are hidden; generic pre-retain presentation routing sends saved or direct legacy addresses to the dedicated view. No legacy Axiom source badge, ordinary message renderer, or normal-chat action is registered.

<a id="model-experience"></a>
## Model Experience

None, as this Client UI adds no model-visible prompt text or tools.

#### KV Cache effect

Source labels and connection status add no model context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Connection status refreshes on request; pending Codex sign-in also polls for completion. A reported connection does not establish that a turn or approval completed; the conversation shows their observed outcomes.
- Dot requires an available desktop bridge and the original website. Unsupported layouts or unloaded older history are reported explicitly. The UI does not copy credentials or emulate a Dot persona.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

The existing package and Codex management-panel identifiers retain layout compatibility. Dot owns a distinct main view and source controller; original website state never enters ordinary Session rendering.

</details>
