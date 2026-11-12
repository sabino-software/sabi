---
kind: discussion
description: "Skeinlet local release scope, milestones, and acceptance evidence."
---
# Skeinlet local release

English | [中文](plan.zh.md)

## Goal

Ship a clean, independently branded macOS coding workspace with work Codex sign-in, existing Codex chat visibility, tools and approvals, and optional genuine Axiom access. Preserve existing local Harness sessions and credentials. Keep reporting off. Build and install locally; do not push, open a PR, or publish externally.

## Milestones

1. Identity complete: Skeinlet native application, original generated raster icon, SVG mark and wordmark, welcome screen and browser branding, independent bundle identity and URL scheme. The MIT license and upstream attribution remain intact. The name is a working identity, without a trademark clearance claim.
2. Existing Codex chats complete: a separate read-only library with title search, archived filter, paged messages, and work-home provenance. Read private SQLite snapshots without resuming, rewriting, or importing source chats. Never read personal Codex or authentication files. Remote images and raw HTML are omitted.
3. Axiom plugin complete: optional `@local/skeinlet-axiom-link` 0.1.1 opens the actual selected ChatGPT Dot through Desktop's Sidebar Browser, with an external fallback. The bundle was authored from the Creator template, reviewed in the user's running Creator chat, and refined from that review and native visual checks. No replacement persona, copied cookies, or private ChatGPT API.
4. Local release complete: standalone Apple Silicon application installed as `~/Applications/Skeinlet.app`. Preserve the existing local profile, omit updater feeds, embed runtimes, verify normal cold launch and visible registrations, and commit locally. This is an ad-hoc signed local release candidate, without notarization or external distribution.

## Coding workflow comparison

| Workflow | Existing implementation | Release action |
|---|---|---|
| Projects and chats | Workspaces, search, archive and forks | Preserve; add work Codex chat library |
| Terminal, tools and approvals | PTY tabs, tool execution and approval cards | Preserve; runtime PTY and live Creator tools checked |
| Git and worktrees | Optional Forge integration | Reuse the existing integration |
| Subagents and automation | Native Harness services | Preserve existing entry points |
| Original Axiom continuity | Genuine ChatGPT Dot page | Optional link plugin; separate ChatGPT website sign-in required |

## Acceptance

The local artifact build and aggregate Host/Client type checks passed. Focused checks cover source-database preservation and paging, resource and slot disposal, Markdown image suppression, branding, native packaging, CLI forwarding, and OAuth-aware cold start. The assembled browser tests passed for chat history, provider authorization, and Axiom installation/navigation/unload. The repository documentation suite passed all 43 gates.

The native runtime passed isolated CLI plugin install/remove, PTY, search, native dependencies, and Office document round trips. The installed application passed strict deep signature verification and normal cold launch without a checkout launcher or development flags. Local package/dependency constraints and changed-file lint passed. These are local checks, not CI or public-release acceptance.

## Current evidence

On 2026-11-12, Computer Use displayed the real work catalog and an existing transcript from `~/.codex`, with read-only provenance, older-message paging and no composer. Current chats use `thread_history_1.sqlite`; JSONL-only discovery would miss them. Synthetic database tests verify unchanged source DB/WAL files and no source SHM creation. Normal concurrent Codex writes are independent of this viewer.

The existing Creator chat completed a read-only plugin review through the stored work Codex subscription. The original credential file remained byte-identical across installation and restarts. The final cold launch recognized the stored provider grant and entered the preserved workspace directly. Runtime metadata confirmed session OTel reporting, product OTel reporting, and client analytics all disabled and unmounted. Axiom's link persisted locally across restart; its private URL is absent from source and release artifacts.

The genuine Axiom page was found in the signed-in work browser. The installed plugin opened that same destination in the native Sidebar Browser and reached ChatGPT's login page. Embedded authentication and a post-login Axiom reply remain user-side acceptance steps. The temporary test tab was closed, and the application was hidden to restore the user's focus and layout.

## Limits and reproduction

The source library shows supported local, paginated text history. It does not resume Codex chats, synchronize remote history, copy attachments/tool output/reasoning, or claim full Codex desktop parity. Future Codex SQLite schema changes may need reader updates. ChatGPT owns Dot continuity, authentication and usage rules; Sidebar Browser cookies currently last until app restart. Optional websites and model providers retain their own network policies.

Rebuild with `pnpm --dir apps/desktop run package:local-fork --dir`. Output is `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/Skeinlet.app`. The embedded runtime CLI manages the desktop profile only while the app is fully quit. Install the optional plugin tarball with `dsh plugin --profile desktop add <tarball> --ignore-scripts --offline` using that embedded CLI and the existing local `DSH_HOME`.

The native shell intentionally retains `~/Library/Application Support/DeepSeek Harness Local` for its Electron and Harness data. Keep this profile when replacing the app with another Skeinlet build. Work Codex source remains `~/.codex`; personal Codex is separate. Upstream Harness updates do not replace this app, and future source merges still require the privacy and sign-in checks above.

Original artwork and generation provenance are in `assets/branding/skeinlet/`: `app-icon.png`, `mark.svg`, `wordmark.svg`, and `prompt.txt`. The packaged icon is a technical 1024px downscale of the original built-in ImageGen output.
