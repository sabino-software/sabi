---
description: "Read-only browsing of existing work Codex chats."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-codex-library

English | [中文](README.zh.md)

## Summary

Browse existing work Codex titles and visible message history from the **Codex chats** sidebar entry. The source home is labeled in the page. This package exposes no source mutation, resume, generation, or authentication operation.

## Use this package

Mount the Host plugin in the desktop profile. `sourceHome` defaults to the OS user's `.codex` directory, independently of `CODEX_HOME` and the app's own storage. An explicit absolute directory can select a work installation. The browser entry registers a main panel and its sidebar icon through the existing registries.

Search matches literal title fragments without case sensitivity. Active and archived catalogs are separate. **Next chats** fetches another catalog page. Selecting a title loads its latest visible messages; **Older messages** reads an earlier page, and **Latest messages** returns to the latest page. Refresh reads the source again. Browsing never turns a source chat into an editable Harness Session.

## Understand the implementation

The Host opens existing `state_5.sqlite` and `thread_history_1.sqlite` files with `readOnly: true`, SQLite `query_only`, extensions disabled, and a 500 ms busy timeout. Symlinked database files are refused. Catalog IDs are SQL parameters and never filesystem paths. No Codex executable is launched, and source configuration, credentials, rollout files, and personal homes are not consulted.

Catalog reads return at most forty rows. Transcript reads return at most forty user or assistant text items, in chronological order, with source timestamps. Each transcript response is capped at 512 KiB including metadata. Items larger than 128 KiB are skipped with a visible notice. Cursor and query inputs are bounded and validated. Malformed or incompatible source data fails visibly with a sanitized, localized retry message.

The browser uses registered resource providers and the shared Markdown renderer. Tool output, reasoning, attachments, and system/developer instructions are excluded. This viewer uses local SQLite reads because the documented [app-server listing](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters) can scan and repair source metadata.

## Model Experience

No model-visible input, tool, or model request is added. Browsing does not consume model tokens.

### KV-cache effect

None. Source messages are presentation data and never enter an agent prompt or Session log.

## Known Limitations and Deferred Work

The reader supports the current paginated SQLite history format. Legacy rollout-only chats fail with an unavailable transcript notice; they are never silently imported or resumed. SQLite filenames and columns are version-specific, so an incompatible future Codex release can make the source unavailable. Pages are independent reads rather than a live cross-database snapshot. Source updates appear after Refresh; there is no background polling. Non-English, Chinese, and Portuguese locales use English fallback copy. Remote Markdown images follow the shared renderer's policy.
