# Sabi

English | [中文](README.zh.md)

[![Sabi artifact build](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml/badge.svg)](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml)

Sabi is an independent macOS coding workspace built from DeepSeek Harness. Continue original work Codex conversations in native chat, use Harness tools and approvals, and optionally connect your original ChatGPT Dot. Existing workspaces, local sessions, and work sign-in stay separate from personal Codex. No DeepSeek account is required; DeepSeek is an optional model provider configured with its own API key.

The public CLI is `sabi`, backed by the existing Harness engine. The next packaged release is `0.3.0-beta.1`; check its exact artifact and [workflow run](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml) before distribution. See the [release verification procedure](docs/fork-release/plan.md).

## Native conversations

Work Codex chats appear as ordinary Sessions in their workspaces. Opening history does not start inference. Sending continues the same original Codex thread through the work app-server. Harness tools are available through a scoped local MCP connection; sandbox selections and approval decisions remain enforced. Source activity appears alongside messages without re-executing imported operations.

Dot is optional. Enable **Show Dot in sidebar** and **Enable Dot integration** in **Settings → General** to place its dedicated button directly below **New Session**. It uses the selected Dot's name, such as Axiom. Its default style matches New Session; Subtle and Outline are available. The button opens a continuous conversation with its own website-inspired theme and older-history scrolling. Dot never appears as an ordinary session or search result. Select your Dot on the original ChatGPT website without entering a URL. The persistent in-app website session powers native history, sending, and observed replies without a browser extension. A regular-browser companion remains an optional fallback.

The connected original page runs hidden while native chat remains usable. **Open ChatGPT** reveals it, and Reload refreshes it. **Close page** destroys the page and stops observation; only another explicit Dot selection reconnects it. Website sign-in survives closing and reopening the page. General Settings does not require a DeepSeek sign-in.

## Privacy defaults

All five fork reporting plugins are disabled and unmounted by default. Sabi does not enable Harness session reporting, product reporting, or client analytics. This does not disable telemetry or network processing performed by a selected model provider, Codex, ChatGPT, or an identity provider. Website credentials stay with the selected website session; Sabi does not copy browser cookies or use private ChatGPT APIs.

## Build and CLI

Read the [safety notice](SAFETY.md), then build the Apple Silicon application from a local checkout:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/desktop run package:local-fork --dir
```

The unpacked application is `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/Sabi.app`. Verify that artifact before replacing an installed app. This local build is not a notarized public release.

Use the application's **Manage sabi Command…** menu item to manage the `sabi` command, then run `sabi --help` or `sabi --version`. The command uses the bundled Electron runtime; it does not require system Node or a checkout, including when its application path contains spaces. It preserves the existing `dsh` command and personal Codex installation.

See the [development guide](docs/development.md), [architecture](docs/architecture.md), and [agent instructions](AGENTS.md) for contributor workflows. APIs remain in developer preview and can break compatibility.

## Run

For the engine's Web UI, use `sabi web` after installing the desktop CLI. The command prints its local URL. Native Codex and Dot integration require the macOS app.

### Run from source

With the [development prerequisites](docs/development.md) installed, run `pnpm install --frozen-lockfile` and `pnpm run build`, then `pnpm dsh web` from the repository root. The source launcher retains the upstream command name. See [source execution](apps/cli/reference/README.md#source-execution) for profiles and plugin development.

## Upstream and license

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is developed by [DeepSeek AI](https://deepseek.com) on an everything-is-a-plugin architecture powered by [Cordis](https://github.com/cordiverse/cordis). Its upstream [documentation](https://deepseek-harness.github.io/deepseek-harness/) describes the underlying engine. Sabi is an independent fork.

The [MIT license](LICENSE), including `Copyright (c) 2026 DeepSeek`, remains intact. Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.
