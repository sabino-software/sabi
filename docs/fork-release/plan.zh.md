---
kind: discussion
description: "Sabi 发布约定与可重复的产物验证。"
---
# Sabi 发布验证

[English](plan.md) | 中文

## 范围

Sabi 是独立品牌的 macOS 工作区与 `sabi` CLI，底层复用现有 Harness 引擎，发布目标仓库为 `sabino-software/sabi`。下一打包版本为 `0.3.0-beta.1`。保留现有工作区、本地会话、已保存的工作 Codex 授权，以及 `~/Library/Application Support/DeepSeek Harness Local` 下的 Electron/Harness 配置。工作 Codex 仍位于 `~/.codex`，个人 Codex 与 `dsh` 命令保持独立。保留 MIT DeepSeek 版权与第三方声明。名称不代表已完成商标审查。

DeepSeek 是通过添加提供方及其 API key 配置的可选提供方。工作区、常规设置、工作 Codex 与原始 ChatGPT Dot 访问均无需 DeepSeek 账户。提供方和 ChatGPT 网站仍有各自的认证要求。

## 对话架构

现有工作 Codex 聊天成为所属工作区中的常规原生会话。打开历史不启动推理；发送消息通过工作 app-server 继续原始 Codex 对话。限定范围且经过认证的本地回环 MCP 连接提供 Harness 工具，执行受现有沙箱选择与审批约束。导入的操作卡片仅为不会执行的来源证据。历史、上下文与恢复的详细约定见[原生对话集成](native-conversations-plan.zh.md)。

可选 Dot 集成使用原始已认证的 ChatGPT 网站作为引擎。持久化的应用内会话无需扩展即可支持原生历史、用户原文发送与观察到的回复。浏览器伴随扩展为可选后备方式。常规设置中的独立选项控制集成启用、侧边栏显示，以及与新会话一致、简洁或轮廓样式。Dot 显示在新会话正下方，无需网址输入框即可选择原始对话。连接后的原始页面在隐藏状态运行；打开 ChatGPT 会显示它，重新加载会刷新它，明确关闭会销毁页面并停止观察，直到再次明确选择 Dot。网站登录状态在此关闭/重新打开周期中保留。详见 [Dot 页面适配器](axiom-native-bridge.zh.md)。

## 隐私默认值

分支的五个报告插件默认全部禁用且未挂载。打包、冷启动、CLI 使用和未来上游合并都需保留此状态。它涵盖 Harness 报告与分析，不涵盖由 Codex、模型提供方、ChatGPT 或身份提供方负责的遥测或网络行为。不得通过复制凭据或浏览器 Cookie 实现 Dot 访问。

## 已验证的核心边界

安装候选版检查实际执行了持久化的应用内 ChatGPT 认证、一次原生 Dot 发送及原始来源标识下观察到的回复，以及来源页面隐藏时的原生交互。重新加载恢复了已登录页面；关闭销毁了页面，后台观察未重新打开它，明确选择 Dot 后无需再次登录即可重新连接。两项侧边栏开关、位置与样式持久化均经过实际检查。这些结果无需浏览器扩展。

工作 Codex 检查通过一次已完成的 Harness bash 调用继续同一原始对话，冷启动后重新打开原生历史，保留所选工作提供方，并保留旧凭据哈希。运行时清单显示五个报告插件全部禁用且未挂载。`sabi` CLI 通过内嵌 Electron 在检出目录之外运行，应用路径含空格且没有系统 Node。这些是本地核心与 CLI 观察，不代表即将发布的 Sabi 品牌包验收或托管 CI 结果。

## 发布验证流程

1. 记录确切源码修订与版本。使用 `pnpm install --frozen-lockfile` 安装，再运行 `pnpm --dir apps/desktop run package:local-fork --dir`。保留打包诊断与生成的 `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/Sabi.app` 标识。
2. 验证该产物的应用签名与正常冷启动。确认 Sabi 品牌、版本、保留的工作区与工作 Codex 授权，以及五个报告插件全部禁用且未挂载。重新检查原始 Codex 连续性、Harness 工具/审批路径，以及 Dot 隐藏页面、重新加载、关闭和重新连接周期，确保没有重复发送。
3. 使用 **Manage sabi Command…** 管理 CLI。在检出目录之外、PATH 不含系统 Node 且应用路径含空格的环境中检查帮助、版本与无害命令。确认现有 `dsh` 和个人 Codex 未改变。
4. 检查确切修订的 [Sabi artifact build](https://github.com/sabino-software/sabi/actions/workflows/sabi-artifacts.yml) 运行、任务结果、测试、签名证据，以及上传的产物与校验和。该工作流生成独立于上游签名基础设施的未签名本地分支产物。工作流定义或徽章不能证明某次运行成功。
5. 分别记录安装产物与托管 CI 证据后再分发。本地临时签名不等同于公证；没有实际发布证据时，不得声称已有公开 npm 发布或已发布下载。

## 发布边界

分别记录本地构建、类型检查与测试结果，安装版验收，GitHub Actions，以及发布。较早的核心候选版不能验证之后的 Sabi 包。本地准备不授权推送、PR、仓库转移或发布。

现有引擎命令与打包流程仍见[桌面参考](../../apps/desktop/README.zh.md)和[开发指南](../development.zh.md)。替换可执行文件时保留应用数据；源码合并不得重置工作认证或报告默认值。
