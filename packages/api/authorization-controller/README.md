---
description: "Provider authorization Remote conversations and browser sign-in state."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-authorization-controller

## Summary

This package connects registered authorization flows to the Models settings page. The Host owns the conversation stream; the browser owns its initiating interaction and redacted state. Provider plugins continue to own OAuth, credential commits, and token refresh.

## Use this package

Mount the default Host plugin beside `authorization`, `credentials`, and `typert`, mount `/client` beside the generated `authorization` Remote namespace, and include `/remote` in the API contribution assembly. The browser service is `ctx.providerAuthorization`.

`list` returns registered methods, whether an attempt is running, and stored-record presence and writability. It never reads or returns a credential payload. A stored record does not guarantee a valid subscription or token.

`begin` streams complete notice, prompt, and terminal frames. An attempt capability addresses `answer` and `cancel`; each prompt has a separate capability, so a withdrawn browser-callback prompt rejects late answers. Closing the stream cancels the attempt and awaits settlement. A lost connection never silently starts another OAuth attempt. `cancel` awaits any credential commit already admitted by the authorization service.

`logout` deletes only the app-owned record for a registered flow and refuses while that flow is running. It does not revoke a provider session or sign out other applications. Provider exceptions are retained as in-process causes for unary refusals; streams expose only terminal status, with no exception text, and answers are never retained in snapshots.

## Model Experience

### Text

None. This package contributes no model prompt or tool.

### Tokens

None. Provider sign-in UI is not sent to the model.

### KV cache

None. Authorization interaction does not change model context.

## Known Limitations and Deferred Work

A disconnected browser cannot determine whether a credential commit completed from the stream alone; it refreshes stored-record status and reports the interruption. Provider token validity is checked when the provider uses the credential. A running sign-in in another browser is visible after refresh; this package does not transfer its prompts between browsers.
