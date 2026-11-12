---
kind: package-reference
description: "Read existing work Codex chat titles and visible messages without starting a model or altering source files."
---

# @deepseek-ai/dsh-api-codex-library-controller

English | [中文](README.zh.md)

## Summary

Read existing work Codex chat titles and visible messages without starting a model or altering source files.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

`sourceHome` defaults to the OS user’s `.codex`, independently of `CODEX_HOME` and the Harness home. An explicit absolute directory selects another work installation. The `codexLibrary` Remote namespace exposes only `list` and `read`; caller access remains owner-only.

Before each query, clone the database and optional WAL into a private directory. Never open source databases through SQLite or copy their shared-memory files. Source metadata must remain stable before and after copying, with at most three attempts. Reject symlinks, active rollback journals, and sources over 2 GiB. SQLite opens only the private copy read-only, with extensions disabled and `query_only`; cleanup removes private files after every query.

The catalog returns at most forty titles with literal search and archive filtering. Transcript pages contain at most forty user or assistant text items, in chronological order, capped at 512 KiB including metadata. Skip individual messages over 128 KiB with a visible notice. IDs are SQL parameters, never file paths. Tool output, reasoning, attachments, authentication and configuration are excluded.

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
