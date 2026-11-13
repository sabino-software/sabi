---
kind: discussion
description: "Sabi release contracts and repeatable artifact verification."
---
# Sabi release verification

English | [中文](plan.zh.md)

## Scope

Sabi is the independently branded macOS workspace and `sabi` CLI backed by the existing Harness engine, with release repository target `sabino-software/sabi`. The next packaged version is `0.3.0-beta.1`. Preserve existing workspaces, local Sessions, the stored work Codex grant, and the Electron/Harness profile at `~/Library/Application Support/DeepSeek Harness Local`. Work Codex remains under `~/.codex`; personal Codex and the `dsh` command stay separate. Preserve the MIT DeepSeek copyright and third-party notices. A name does not establish trademark clearance.

DeepSeek is an optional provider configured through Add provider with its API key. No DeepSeek account is required for the workspace, General Settings, work Codex, or original ChatGPT Dot access. Providers and the ChatGPT website retain their own authentication requirements.

## Conversation architecture

Existing work Codex chats become ordinary native Sessions in their workspaces. History opening starts no inference; sending continues the original Codex thread through the work app-server. A scoped authenticated loopback MCP connection provides Harness tools, with existing sandbox selections and approvals governing execution. Imported operation cards are inert source evidence. The [native conversation integration](native-conversations-plan.md) owns detailed history, context, and recovery contracts.

Optional Dot integration uses the original authenticated ChatGPT website as its engine. Its persistent in-app session supports native history, exact user-authored sends, and observed replies without an extension. The browser companion is an optional fallback. Independent General Settings preferences control integration enablement, sidebar visibility, and Match New Session/Subtle/Outline styling. The selected Dot's name appears directly below New Session and is the sole entry to its dedicated continuous view; Dot does not create an ordinary Session or model turn. Legacy mirrors are hidden without deleting their logs. Original source IDs and order govern the timeline, with a website-inspired theme and preceding-history pagination isolated from the live page. Selection requires no URL textbox. The connected original page runs hidden; Open ChatGPT reveals it, Reload refreshes it, and explicit Close destroys it and stops observation until another explicit Dot selection. Website sign-in persists across that close/reopen cycle. See the [Dot page adapter](axiom-native-bridge.md).

## Privacy defaults

All five fork reporting plugins are disabled and unmounted by default. Preserve this state across packaging, cold launch, CLI use, and future upstream merges. It covers Harness reporting and analytics, not telemetry or network behavior owned by Codex, model providers, ChatGPT, or identity providers. Never copy credentials or browser cookies to implement Dot access.

## Verified core boundary

Installed-candidate checks exercised persistent in-app ChatGPT authentication, one native Dot send and its observed reply under the original source identity, and native interaction with the source page hidden. Reload recovered the signed-in page; Close destroyed it, background observation did not reopen it, and explicit Dot selection reconnected without another login. Both sidebar flags, placement, and style persistence were exercised. These results require no browser extension.

Work Codex checks continued the same original thread through a completed Harness bash call, reopened native history after a cold restart, retained the selected work provider, and preserved the legacy credential hash. Runtime inventory showed all five reporters disabled and unmounted. The `sabi` CLI ran through bundled Electron outside a checkout, from a path containing spaces, without system Node. These are local core and CLI observations, not acceptance of the forthcoming Sabi-branded package or a hosted CI result.

## Release verification procedure

1. Record the exact source revision and version. Install with `pnpm install --frozen-lockfile`, then run `pnpm --dir apps/desktop run package:local-fork --dir`. Retain the packaging diagnostics and resulting `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/Sabi.app` identity.
2. Verify the app signature and a normal cold launch of that artifact. Confirm Sabi branding/version, preserved workspaces and work Codex grant, and all five reporting plugins disabled and unmounted. Recheck original Codex continuation, a Harness tool/approval path, and the Dot hidden-page/Reload/Close/reconnect cycle without duplicate sends. Verify the top named Dot button is the sole conversation entry, legacy mirrors are hidden from lists/search/pickers, source chronology is retained, and older-history scrolling preserves the viewport and live replies.
3. Use **Manage sabi Command…** to manage the CLI. Check help/version and a harmless command outside the checkout with system Node absent from PATH and a space-containing app path. Confirm existing `dsh` and personal Codex are unchanged.
4. Inspect the exact revision's [Sabi artifact build](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml) run, job results, tests, signature evidence, and uploaded artifact/checksums. The workflow targets an unsigned local-fork artifact without upstream signing infrastructure. A workflow definition or badge is not proof a run succeeded.
5. Record installed-artifact and hosted-CI evidence separately before distribution. A local ad-hoc signature is not notarization; do not claim a public npm release or published download without its actual release evidence.

## Release boundary

Keep local build/typecheck/test results, installed-app acceptance, GitHub Actions, and publication separate. An earlier core candidate does not validate a later Sabi package. Local preparation does not authorize a push, PR, repository transfer, or publication.

Existing engine commands and packaging procedures remain in the [Desktop reference](../../apps/desktop/README.md) and [development guide](../development.md). Preserve application data when replacing the executable; source merges must not reset work authentication or reporting defaults.
