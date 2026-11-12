---
kind: package-reference
description: "The **Codex chats** sidebar entry shows existing work conversations in a separate read-only library."
---

# @deepseek-ai/dsh-client-ui-codex-library

English | [中文](README.zh.md)

## Summary

The **Codex chats** sidebar entry shows existing work conversations in a separate read-only library.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount this UI beside the Codex Library API and the standard browser services. Search literal title fragments, switch between Active and Archived, select a title, then page through older visible messages. Refresh reads the source again. The source home stays visible above the catalog.

Source chats have no composer and are never imported into Harness history, resumed, or sent to a model. Markdown renders with raw HTML and images omitted; viewing a source message cannot automatically fetch an external image. **All chats** returns from a transcript on narrow displays.

The [API owner](../../api/codex-library-controller/README.md) documents source selection, private snapshots, bounds, and compatibility.

## Model Experience

None, as this package adds no model prompt, tool, or model request.

#### KV Cache effect

No effect on model context.

## Known Limitations and Deferred Work

- Only current paginated SQLite history is supported. Legacy rollout-only and remote chats are outside this release. Codex schema changes can make the source unavailable; no repair or rewrite is attempted. Refresh shows updates; no background polling runs.

### Dev Note

<details>
<summary>Maintainer context</summary>

Source history is presentation data only.

</details>
