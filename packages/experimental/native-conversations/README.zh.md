---
description: "继续工作 Codex Session，并保留专用 Dot 视图的兼容元数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-conversations

[English](README.md) | 中文

## 概述

通过普通 Harness Session 继续原始工作 Codex 对话。Dot 使用独立桌面视图；已有 Axiom 镜像被隐藏，但其日志不会删除。

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

打开 **Native conversations** 刷新工作 Codex 元数据。同步将原始 Codex 对话关联到稳定的 Harness Session 标识，仅在打开时载入来源消息。Dot 不参与此导入。

Codex 使用已连接的工作守护进程，与个人 Codex 主目录分离。直接文本或图像轮次继续绑定的原始对话，或为新的原生 Codex Session 创建对话。若原始对话在其他客户端存在未完成轮次，则拒绝继续。Harness 通过临时、经过身份验证的回环 MCP 端点暴露当前 Agent 声明的工具，并由已有执行和审批服务处理调用。取消只中断当前操作已确认的精确轮次，不停止无关 Codex 工作。

Dot 是由顶部 Dot 按钮打开的专用连续视图，不是 Harness Session 或 LLM 提供方。可信桌面页面桥接负责选择、网站认证、快照与发送。已有 Axiom 镜像日志及其持久化读取器保持不变。呈现策略从普通 Session 发现入口隐藏这些镜像并拒绝常规打开；已保存的标识转向专用 Dot 视图。已弃用的 `connectAxiom(url)` 仅选择原始页面并返回 `{ url, phase }`，不再返回 Session 标识。

<a id="configure-the-service"></a>
## 配置服务

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `fallbackCwd` | 系统主目录加 `Documents/deepseek-harness-default-workspace` | 来源目录不可用时使用的工作区。 |
| `codexPollIntervalMs` | `2000` | 空闲 Codex 对话已完成来源轮次的观察间隔。 |
| `codexLoginTimeoutMs` | `300000` | 等待托管 Codex 浏览器回调的最长时间。 |
| `codexLoginCancelTimeoutMs` | `5000` | 取消本应用指定 Codex 登录的期限。 |
| `axiomRequestTimeoutMs` | `30000` | 桌面页面操作期限。 |
| `axiomPollIntervalMs` | `750` | 保留的旧配置字段；专用 Dot 视图不使用。 |
| `axiomResponseTimeoutMs` | `300000` | 保留的旧配置字段；专用 Dot 视图不使用。 |
| `axiomSettleMs` | `1500` | 保留的旧配置字段；专用 Dot 视图不使用。 |

仅所有者可用的 Remote 接口包括 `status`、`syncCodex`、`connectAxiom`、`showAxiomLogin` 和 `useCodex`。欢迎操作选择已完成身份验证的工作订阅，不创建或复制授权。Session 投影 `nativeConversation` 标识来源，来源消息检查点防止重复摄取。周边对话服务参见 [session-query 子系统参考](../../../docs/subsystems/session-query.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 原生来源轮次

#### 模型可见内容

Codex 保留原始对话。`turn/start` 接收直接用户文本和准入图像，`mcp_servers.skeinlet` 暴露当前步骤的 Harness 工具声明。原始 Dot 通过其网站接收用户文本。连接元数据和来源网址不会成为额外的人格指令。

#### Token 影响

Codex 轮次使用原始 Codex 账户。Dot 不运行 Harness 模型轮次。元数据读取和 Codex 历史载入不生成模型回复；Harness 工具 schema 和结果可能增加 Codex 输入。

#### KV Cache 影响

缓存行为由原始服务拥有。保留来源对话不保证缓存复用；Harness 工具声明或指令变化可能影响缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 原始服务必须已经运行并完成身份验证。网站 DOM 或认证变化可能使 Axiom 不可用。
- Axiom 历史只包含有界的已渲染页面窗口，并报告截断情况；不包括未加载或虚拟化的历史。
- 支持直接 OpenAI 登录。外部社交或企业身份提供方导航需要获准的目标地址。
- 复制或分叉的 Harness Session 不会静默重绑到原始来源。继续该副本前需在来源应用中创建分叉。
- Codex 拒绝辅助标题和压缩请求。Dot 发送由专用网站桥接负责，不经过 Harness 模型循环。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
