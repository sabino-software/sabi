---
description: "通过普通 Harness Session 继续原始工作 Codex 和 ChatGPT Dot 对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-native-conversations

[English](README.md) | 中文

## 概述

`ctx.nativeConversations` 服务将普通 Harness Session 绑定到原始 Codex 对话或选定的 ChatGPT Dot 页面。交互仍使用标准工作区侧边栏、对话记录和输入框，来源标记注明原始对话。原生推理在原始来源执行，不使用替代人格或第二个模型提供方账户。

## 使用此包

隔离的桌面分支通过 `DSH_NATIVE_CONVERSATIONS=1` 启用此服务，默认 Web 组合保持禁用。将它挂载在 Session、持久化、工作区、Agent、模型、工具、沙箱和审批服务之后，并同时挂载 [`dsh-host-codex-app-server`](../../host/codex-app-server/README.zh.md)。桌面 Host 通过 `attachAxiomTransport` 连接原始页面传输，浏览器代码不能提供该传输。

打开**原生对话**，刷新 Codex 元数据或连接已有的 ChatGPT Dot 网址。服务启动时也会同步 Codex。来源身份映射到稳定的本地 Session ID，因此刷新会附加已有条目，而不重复导入同一对话。打开其 Agent 时才载入原始用户和助手文本，摄取检查点保留原始消息 ID，不虚构历史工具或模型执行。

Codex 使用已连接的工作守护进程，与个人 Codex 主目录分离。直接文本轮次继续绑定的原始对话，或为新的原生 Codex Session 创建对话。若原始对话在其他客户端存在未完成轮次，则拒绝继续。Harness 通过临时、经过身份验证的回环 MCP 端点暴露当前 Agent 声明的工具，并由已有执行和审批服务处理调用。取消只中断当前操作已确认的精确轮次，不停止无关 Codex 工作。

Axiom 使用桌面拥有的原始 ChatGPT 页面。需要时通过**打开 ChatGPT 登录**直接登录，Cookie 和令牌存储保留在独立的 Electron 会话内。适配器只通过原始网站输入框发送用户编写的原文，并观察新的原始助手消息 ID。它不调用 ChatGPT 模型 API，也不创建仿制 Dot。被拒绝或结果不确定的提交不会自动重试。取消 Harness 观察不会点击未被观察确认的网站停止控件。

## 配置服务

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `fallbackCwd` | 系统主目录加 `Documents/deepseek-harness-default-workspace` | 来源目录不可用时使用的工作区。 |
| `axiomRequestTimeoutMs` | `30000` | 桌面页面操作期限。 |
| `axiomPollIntervalMs` | `750` | 原始页面观察间隔。 |
| `axiomResponseTimeoutMs` | `300000` | 最长回复观察时间。 |
| `axiomSettleMs` | `1500` | 文本稳定且页面空闲后判定完成的间隔。 |

仅所有者可用的 Remote 接口包括 `status`、`syncCodex`、`connectAxiom` 和 `showAxiomLogin`。Session 投影 `nativeConversation` 标识来源，来源消息检查点防止重复摄取。周边对话服务参见 [session-query 子系统参考](../../../docs/subsystems/session-query.zh.md)。

## 模型体验

### 原生来源轮次

#### 模型可见内容

Codex 保留原始对话，并通过 MCP 接收直接用户文本和当前步骤的 Harness 工具声明。原始 Dot 通过其网站接收用户文本。连接元数据和来源网址不会成为额外的人格指令。

#### Token 影响

原生轮次使用原始 Codex 或 ChatGPT 账户。元数据同步和历史载入不生成模型回复。Harness 工具 schema、指令和工具结果可能增加 Codex 轮次输入。

#### KV Cache 影响

缓存行为由原始服务拥有。保留来源对话不保证缓存复用；Harness 工具声明或指令变化可能影响缓存。

## 已知限制与待办工作

原始服务必须运行并已完成身份验证。Axiom 历史是带有截断标识的有限已渲染页面窗口，不承诺完整的虚拟化历史。网站 DOM 或身份验证变化可能使适配器不可用。文本优先的桥接不重放历史工具、不自动获取图片，也不暴露任意网站交互。实时登录、原始来源连续性以及端到端工具执行需要运行时验证，不能仅凭安装包或源代码夹具确认。
