---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-12-native-authored-times

English | [中文](2026-11-12-native-authored-times.zh.md)

## Summary

Retains original authored timestamps when importing native Codex and Axiom messages without changing receipt time or Session order.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-12-native-authored-times
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "d5523a8a468194a181adc3b48993f59facefaef2fbab5d3211275bdd4913e1e3"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "a4eeab4066b8ac256303ef6b2a5a96cad8ce27e643328c82dfd84a22777c82a9"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "14538a9a7f0e63a947829b0ed947a6c34f5c6e1eabab06abf45b503374853c66"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "a75d3e68aa057eaaffd19a6138c24e3e10a9b17ccf0d753f4c48720cc35d4306"
    decision: same-version
  - root: "event:system/message"
    previous: "2026-09-16-session-format-v4"
    after: "c23657c6f53abb23f432c6c3aba0d2417c9146abe94142f4bc086a20327b41b8"
    decision: same-version
  - root: "event:tool/result"
    previous: "2026-09-16-session-format-v4"
    after: "c06182cd8d9b3fe07a1dda3f54c246fae8198de9c3628134a3c5de75b6a32f55"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "03d511bcc115ae2e6175de46ede985f139609b2d408b9596c0329f070445355a"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Same Session format version: authoredAt is optional informational metadata inside existing message payloads, never a new event envelope field. Old payloads omit it and retain receipt clocks; imported messages carry an epoch-millisecond Date or explicit null when the source did not record a date. Pre-change built Session reader was verified to retain the extra user-message property and canonical receipt time. New readers validate present author dates at append and restore; existing identity, source, content, sequence, and model replay semantics are unchanged. Sidebar source-time marker is an optional cached projection field; its stateVersion increases for replay. Previously hydrated local mirrors are not repaired by this change.

<a id="verification"></a>
## Verification

Integrated focused tests passed: 127 across core append validation, native history import, Host authored-time projection and recency, Axiom rendering, and conversation node definitions. The assembled client manager author-clock regression also passed. Type-aware scoped lint passed. A pre-change built Session reader accepted and retained the new field in an in-memory compatibility probe. Persistence inventory, schema acknowledgement and format gates run separately; no claim is made that previously hydrated mirrors are repaired.

<a id="dev-note"></a>
## Dev Note

None.
