---
kind: upgrade-guide
description: "Dot conversations leave ordinary Harness Session discovery and use a dedicated continuous view."
---

# Dot uses a dedicated view

English | [中文](guide.zh.md)

## Change

ChatGPT Dot/Axiom no longer appears as an ordinary Harness Session, model provider, history search result, archived row or pinned chat. Existing mirror logs and persisted reader generations remain unchanged. Codex and ordinary Sessions keep their existing behavior. The legacy `nativeConversations.connectAxiom(url)` response changes from `{ sessionId }` to `{ url, phase }` and creates no Session.

## Migration

1. Open the top Dot button to use the original conversation in its dedicated view. Existing website authentication and identity remain owned by the desktop page bridge.
2. Client integrations must query `session.presentation({ sessionId })` before retaining an old saved identity. Dispatch a hidden result through its generic `route`; never open it as a normal chat. The Dot route is `{ view: "dot", params: { url } }`.
3. Replace any assumption that `connectAxiom` returns a Session id. Use the dedicated desktop Dot selection and snapshot/send interface instead; keep existing stored logs and source records.
4. Confirm old Dot mirrors are absent from active, archived, pinned and search results, and old saved links reach Dot. Confirm an ordinary or Codex chat still opens normally.
