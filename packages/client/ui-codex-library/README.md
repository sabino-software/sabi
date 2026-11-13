---
kind: package-reference
description: "Manage native Codex and Axiom connections while continuing conversations in the ordinary workspace sidebar."
---

# @deepseek-ai/dsh-client-ui-codex-library

English | [中文](README.zh.md)

## Summary

Existing Codex and Axiom conversations appear as ordinary Harness Sessions in the workspace sidebar. Source badges identify the original execution source in each row and conversation header. The **Native conversations** page manages connections; it does not contain a separate history browser.

## Table of Contents

- [Use this package](#use)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use"></a>
## Use this package

Mount this UI beside the [native conversation service](../../experimental/native-conversations/README.md), standard Session and Workspace services, and resource registry. Open **Native conversations** to read connection status, manually sync Codex threads, select your original ChatGPT Dot without entering a URL, or open the desktop bridge's ChatGPT login. Refresh reads status again; operations report failures and disable conflicting actions until they finish. A successful Axiom connection opens its ordinary Session.

In **Settings → General**, **Enable Dot integration** and **Show Dot in sidebar** are independent saved options. The integration defaults to enabled and sidebar visibility defaults to off. When both are enabled and the desktop and native conversation plugins are available, **Dot** appears directly below **New Session**, including while signed out. Selecting it opens the original ChatGPT website for sign-in or Dot selection. Only that explicit selection can open a ready Dot as an ordinary Session; later background website updates do not steal focus. Disabling the integration or unloading the plugin cancels pending navigation.

For a signed-out work Codex account, select **Sign in to work Codex**, then **Continue in browser**. Codex owns the local callback and credential storage. The panel confirms the account before showing success; **Cancel Codex sign-in** cancels only this pending attempt. An already signed-in account is not replaced. This sign-in does not authenticate the separate ChatGPT website session used by Axiom.

Open conversations directly from their workspace groups. Standard conversation rendering, composition, streaming, tool cards, and approval presentation remain with their existing owners. The Host service owns original thread identity, hydration, execution, and approval routing. Source badges read the `nativeConversation` projection; rendering sidebar badges does not activate the listed Sessions. Codex model and permission controls remain available, while Axiom's original ChatGPT application owns those settings.

On a desktop build with the companion, **Axiom sign-in connection** reads the saved mode without changing it. The app uses its authenticated ChatGPT website session; **Use regular browser** is an optional extension fallback. Existing saved transport choices are preserved. Browser mode shows the local extension folder, registration script, bundled Node path, and the three requested permissions for manual setup; the panel does not install them. Sign-in and cookies remain in the selected browser profile. After opening the Dot, click the extension toolbar button and approve its native pairing prompt; repeat pairing after a reload or new login. An unavailable companion build keeps its saved mode and reports the limitation. See the [browser bridge reference](../../../docs/fork-release/axiom-browser-bridge.md) for installation and source-window limits.

For an already signed-in account, select **Use work Codex for new chats** to choose its subscription as the default for future chats. The panel confirms the saved selection; opening this page does not change it or replace the account.

<a id="model-experience"></a>
## Model Experience

None, as this Client UI adds no model-visible prompt text or tools.

#### KV Cache effect

Source labels and connection status add no model context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Connection status refreshes on request; pending Codex sign-in also polls for completion. A reported connection does not establish that a turn or approval completed; the conversation shows their observed outcomes.
- Axiom connection and login require an available desktop bridge. The UI does not copy credentials or emulate a Dot persona.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

The existing package and main-panel identifiers are retained for layout compatibility; the separate read-only catalog and transcript resource providers are removed.

</details>
