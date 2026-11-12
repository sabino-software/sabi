---
kind: package-reference
description: "Manage native Codex and Axiom connections while continuing conversations in the ordinary workspace sidebar."
---

# @deepseek-ai/dsh-client-ui-codex-library

English | [中文](README.zh.md)

## Summary

Existing Codex and Axiom conversations appear as ordinary Harness Sessions in the workspace sidebar. Source badges identify the original execution source in each row and conversation header. The **Native conversations** page manages connections; it does not contain a separate history browser.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount this UI beside the [native conversation service](../../experimental/native-conversations/README.md), standard Session and Workspace services, and resource registry. Open **Native conversations** to read connection status, manually sync Codex threads, connect an original Axiom Dot URL, or open the desktop bridge's ChatGPT login. Refresh reads status again; operations report failures and disable conflicting actions until they finish. A successful Axiom connection opens its ordinary Session.

Open conversations directly from their workspace groups. Standard conversation rendering, composition, streaming, tool cards, and approval presentation remain with their existing owners. The Host service owns original thread identity, hydration, execution, and approval routing. Source badges read the `nativeConversation` projection; rendering sidebar badges does not activate the listed Sessions. Codex model and permission controls remain available, while Axiom's original ChatGPT application owns those settings.

## Model Experience

This UI adds no prompt text, tools, or model requests. Its operations call the native conversation service, which owns any execution effects.

#### KV Cache effect

Source labels and connection status add no model context.

## Known Limitations and Deferred Work

- Status is refreshed explicitly rather than polled. A reported connection does not establish that a turn or approval completed; the conversation shows their observed outcomes.
- Axiom connection and login require an available desktop bridge. The UI does not copy credentials or emulate a Dot persona.

### Dev Note

<details>
<summary>Maintainer context</summary>

The existing package and main-panel identifiers are retained for layout compatibility; the separate read-only catalog and transcript resource providers are removed.

</details>
