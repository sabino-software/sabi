# Native conversation integration

English | [中文](native-conversations-plan.zh.md)

Existing work Codex conversations become ordinary Harness Sessions in their workspace sidebar. Their original Codex thread remains authoritative. Opening history does not start a turn. Sending continues that thread through the work app-server, with scoped Harness tools provided through an authenticated loopback MCP endpoint. Existing Harness approvals and sandbox selections govern that endpoint and native Codex operations.

Axiom uses the original authenticated ChatGPT page as its engine. The native conversation displays observed original messages and sends exact user-authored input through that page's real composer. Browser credentials remain in a dedicated Electron session. Unsupported page states and ambiguous sends fail explicitly without retrying.

Implementation and acceptance:

1. Persist source bindings and hydrate original messages into ordinary Sessions without duplicating source messages on reopen.
2. Stream owned Codex turns, route approvals, map permissions and models, and expose prepared Harness tools without double execution. Never interrupt another client's turn.
3. Connect Axiom's native Session to the owned desktop page bridge; retain original identity, disclose the rendered history boundary, and provide sign-in only when required.
4. Run focused transport, hydration, stream, approval, and desktop bridge tests. Verify real Codex continuation and a real Harness tool in a designated test thread. Verify original Axiom history and interaction in the installed Mac app.
5. Rebuild and install locally, check source deduplication after restart, preserve the work grant and telemetry defaults, inspect the diff, and commit locally. No push or PR.

The goal stays active until these runtime checks pass. A launcher, a read-only transcript, or configured-but-unused tools do not meet acceptance.
