# Sabi

[English](README.md) | 中文

[![Sabi artifact build](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml/badge.svg)](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml)

Sabi 是基于 DeepSeek Harness 的独立 macOS 编程工作区。它支持在原生聊天界面继续原始工作 Codex 对话、使用 Harness 工具与审批，并可选连接原始 ChatGPT Dot。现有工作区、本地会话与工作登录保持独立于个人 Codex。无需 DeepSeek 账户；DeepSeek 是使用自身 API key 配置的可选模型提供方。

公开 CLI 为 `sabi`，底层复用现有 Harness 引擎。下一打包版本为 `0.3.0-beta.1`，分发前须检查确切产物与[工作流运行](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml)。详见[发布验证流程](docs/fork-release/plan.zh.md)。

## 原生对话

工作 Codex 聊天作为常规会话出现在所属工作区。打开历史不会启动推理。发送消息通过工作 app-server 继续同一个原始 Codex 对话。Harness 工具通过限定范围的本地 MCP 连接提供，沙箱选择与审批决定仍受执行约束。来源活动与消息一起显示，不会重新执行导入的操作。

Dot 为可选功能。在**设置 → 常规**中同时启用**在侧边栏显示 Dot**与**启用 Dot 集成**，即可将专用按钮放在**新会话**正下方。按钮使用选定 Dot 的名称，如 Axiom。默认样式与新会话一致，也可选择简洁或轮廓。按钮打开连续对话，使用网站主题并支持向上滚动旧历史。Dot 不出现在普通会话或搜索结果中。在原始 ChatGPT 网站选择 Dot，无需输入网址。持久化的应用内网站会话支持原生历史、发送与观察到的回复，无需浏览器扩展。常规浏览器伴随扩展仍为可选后备方式。

原始页面连接后在隐藏状态运行，原生聊天仍可使用。**打开 ChatGPT**会显示它，重新加载会刷新它。**关闭页面**会销毁页面并停止观察；只有再次明确选择 Dot 才会重新连接。关闭并重新打开页面后，网站登录状态保留。常规设置不要求 DeepSeek 登录。

## 隐私默认值

分支的五个报告插件默认全部禁用且未挂载。Sabi 不启用 Harness 会话报告、产品报告或客户端分析。这不禁用所选模型提供方、Codex、ChatGPT 或身份提供方执行的遥测或网络处理。网站凭据保留在所选网站会话中；Sabi 不复制浏览器 Cookie，也不使用 ChatGPT 私有 API。

## 构建与 CLI

阅读[安全说明](SAFETY.zh.md)，然后在本地检出目录构建 Apple Silicon 应用：

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/desktop run package:local-fork --dir
```

未打包的应用位于 `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/Sabi.app`。替换已安装应用前须验证该产物。本地构建不等同于经过公证的公开发布。

通过应用菜单中的 **Manage sabi Command…** 管理 `sabi` 命令，然后运行 `sabi --help` 或 `sabi --version`。该命令使用内嵌 Electron 运行时，不依赖系统 Node 或检出目录，应用路径包含空格时也可使用。它保留现有 `dsh` 命令和个人 Codex 安装。

贡献者工作流见[开发指南](docs/development.zh.md)、[架构](docs/architecture.zh.md)与[智能体说明](AGENTS.md)。API 仍处于开发者预览阶段，可能出现兼容性破坏。

## Run

安装桌面 CLI 后，使用 `sabi web` 启动引擎的 Web UI。命令会打印本地网址。原生 Codex 和 Dot 集成需要 macOS 应用。

### Run from source

安装[开发前提条件](docs/development.zh.md)后，在仓库根目录运行 `pnpm install --frozen-lockfile` 和 `pnpm run build`，然后运行 `pnpm dsh web`。源码启动器保留上游命令名称。配置与插件开发见[源码执行](apps/cli/reference/README.zh.md#source-execution)。

## 上游与许可证

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 由 [DeepSeek AI](https://deepseek.com) 开发，采用由 [Cordis](https://github.com/cordiverse/cordis) 驱动的一切皆插件架构。其上游[文档](https://deepseek-harness.github.io/deepseek-harness/)介绍底层引擎。Sabi 是独立分支。

保留完整 [MIT 许可证](LICENSE)，包括 `Copyright (c) 2026 DeepSeek`。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。
