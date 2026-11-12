---
description: "通过普通 Harness Session 继续原始工作 Codex 和 ChatGPT Dot 对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-conversations

[English](README.md) | 中文

## 概述

从常规 Harness 侧边栏、对话记录和输入框继续原始工作 Codex 与选定的 ChatGPT Dot 对话。来源标记注明原始对话。推理与来源历史仍由原始应用和账户负责。

## 目录

- [使用此包](#use-this-package)
- [配置服务](#configure-the-service)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

隔离的桌面分支通过 `DSH_NATIVE_CONVERSATIONS=1` 启用此服务，默认 Web 组合保持禁用。将它挂载在 Session、投影缓存、Session Controller、标题、存储域、持久化、工作区、Agent、模型、工具、沙箱和审批服务之后，并同时挂载 [`dsh-host-codex-app-server`](../../host/codex-app-server/README.zh.md)。桌面 Host 通过 `attachAxiomTransport` 连接原始页面传输，浏览器代码不能提供该传输。

未登录的工作账户可通过原生连接面板在常规浏览器中登录。显式托管登录使用 `account/login/start`，Codex 负责 localhost 回调和凭据。服务匹配登录 ID 与连接代次，验证 `account/read` 后选择工作模型并刷新来源元数据。状态不包含授权网址或凭据。取消仅针对本服务创建的等待中登录。保留现有已登录账户；Codex 授权不授予 ChatGPT 对话历史，也不认证 Axiom 的网站会话。

打开**原生对话**，刷新 Codex 元数据或连接已有的 ChatGPT Dot 网址。服务启动时也会同步 Codex。持久化来源映射同时复用导入的 Session ID 和通过 Harness 首次创建的对话，因此刷新不会重复导入。打开其 Agent 时才载入原始用户和助手文本，摄取检查点保留原始消息 ID，历史操作显示为不会重新执行的来源活动卡片。空闲且打开的 Codex 对话也会刷新已完成的来源轮次，不启动推理。

Codex 使用已连接的工作守护进程，与个人 Codex 主目录分离。直接文本或图像轮次继续绑定的原始对话，或为新的原生 Codex Session 创建对话。若原始对话在其他客户端存在未完成轮次，则拒绝继续。Harness 通过临时、经过身份验证的回环 MCP 端点暴露当前 Agent 声明的工具，并由已有执行和审批服务处理调用。取消只中断当前操作已确认的精确轮次，不停止无关 Codex 工作。

Axiom 使用桌面拥有的原始 ChatGPT 页面。需要时通过**打开 ChatGPT 登录**直接登录，Cookie 和令牌存储保留在独立的 Electron 会话内。适配器只通过原始网站输入框发送用户编写的原文，并观察新的原始助手消息 ID。它不调用 ChatGPT 模型 API，也不创建仿制 Dot。被拒绝或结果不确定的提交不会自动重试。取消 Harness 观察不会点击未被观察确认的网站停止控件。

<a id="configure-the-service"></a>
## 配置服务

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `fallbackCwd` | 系统主目录加 `Documents/deepseek-harness-default-workspace` | 来源目录不可用时使用的工作区。 |
| `codexPollIntervalMs` | `2000` | 空闲 Codex 对话已完成来源轮次的观察间隔。 |
| `codexLoginTimeoutMs` | `300000` | 等待托管 Codex 浏览器回调的最长时间。 |
| `codexLoginCancelTimeoutMs` | `5000` | 取消本应用指定 Codex 登录的期限。 |
| `axiomRequestTimeoutMs` | `30000` | 桌面页面操作期限。 |
| `axiomPollIntervalMs` | `750` | 原始页面观察间隔。 |
| `axiomResponseTimeoutMs` | `300000` | 发送确认操作的最长生命周期。 |
| `axiomSettleMs` | `1500` | 后备流适配器的稳定间隔；桌面使用持续来源观察。 |

仅所有者可用的 Remote 接口包括 `status`、`syncCodex`、`connectAxiom`、`showAxiomLogin` 和 `useCodex`。欢迎操作选择已完成身份验证的工作订阅，不创建或复制授权。Session 投影 `nativeConversation` 标识来源，来源消息检查点防止重复摄取。周边对话服务参见 [session-query 子系统参考](../../../docs/subsystems/session-query.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 原生来源轮次

#### 模型可见内容

Codex 保留原始对话。`turn/start` 接收直接用户文本和准入图像，`mcp_servers.skeinlet` 暴露当前步骤的 Harness 工具声明。原始 Dot 通过其网站接收用户文本。连接元数据和来源网址不会成为额外的人格指令。

#### Token 影响

原生轮次使用原始 Codex 或 ChatGPT 账户。元数据同步和历史载入不生成模型回复。Harness 工具 schema、指令和工具结果可能增加 Codex 轮次输入。

#### KV Cache 影响

缓存行为由原始服务拥有。保留来源对话不保证缓存复用；Harness 工具声明或指令变化可能影响缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 原始服务必须已经运行并完成身份验证。网站 DOM 或认证变化可能使 Axiom 不可用。
- Axiom 历史只包含有界的已渲染页面窗口，并报告截断情况；不包括未加载或虚拟化的历史。
- 支持直接 OpenAI 登录。外部社交或企业身份提供方导航需要获准的目标地址。
- 复制或分叉的 Harness Session 不会静默重绑到原始来源。继续该副本前需在来源应用中创建分叉。
- 原生适配器拒绝辅助标题和压缩请求。Axiom 只接受文本；其桥接不重放历史工具、不自动获取图片，也不暴露任意网站交互。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
