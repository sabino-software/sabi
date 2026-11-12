---
description: "通过原生 Host 连接已有的工作 Codex 守护进程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-codex-app-server

[English](README.md) | 中文

## 概述

连接已运行的工作 Codex 应用，即可列出原始聊天、读取历史，并发送经过授权的轮次。调用方可在保留原始对话标识的同时处理原生审批和问题请求。守护进程必须已经运行；本包不创建 Harness Session。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

加载 Host 插件后调用 `connect()` 或 `request(method, params, signal?)`。`sourceHome` 默认为操作系统用户的 `.codex`，不依赖 `CODEX_HOME`；`socketPath` 默认为该目录下的 `app-server-control/app-server-control.sock`。初始化会核对守护进程报告的来源目录，确认后才允许对话操作。传输层不读取认证或配置文件，不启动或重启守护进程，也不访问个人 Codex 目录。

托管浏览器登录通过 `account/login/start` 与 `type: "chatgpt"` 提供，`account/login/cancel` 只取消指定登录。守护进程提供授权网址、托管 localhost 回调并负责凭据持久化。调用方仅在用户明确操作后打开链接，按登录 ID 匹配完成通知，并验证 `account/read`。调用方不捕获令牌，也不创建第二个回调服务器。此授权用于 Codex，不暴露 ChatGPT 网页对话历史，也不共享浏览器的网站会话。

`request` 只接受声明的目录、历史、模型、对话和轮次操作。参数和结果保留官方字段名。调用方负责各方法的校验、授权、Session 投影和分页。如果浏览不应触发上游元数据修复，使用 `thread/list.useStateDbOnly: true`。恢复对话时使用 `thread/resume.excludeTurns: true` 和历史分页方法。

`onNotification` 和 `onStatus` 返回可释放的订阅。`setRequestHandler` 为批准、问题、信息收集或动态工具方法指定唯一处理方。处理方收到原始请求标识、连接代次和取消信号。请求已解决、轮次结束、连接中断或插件释放时，等待中的处理会被取消；迟到的答案不会发送。缺少处理方时，默认取消批准、拒绝权限、关闭问题或报告工具不可用。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

每个连接先执行 `initialize`，再发送 `initialized`。帧大小、输出队列和并发请求均有完整限制。请求设有期限；已经提交的修改在响应丢失、取消或超时后报告 `outcomeUnknown`，不会自动重放。后续明确请求可以重新连接，但调用方必须先恢复订阅并读取最新历史。释放时只关闭本包持有的 WebSocket，并等待关闭完成；不发送轮次中断或守护进程控制命令。

支持的消息由[官方协议](https://learn.chatgpt.com/docs/app-server)和 CLI 0.167.1 生成的类型定义。Unix 套接字需要 WebSocket 升级握手。`codex app-server proxy` 仅转发字节，不把 JSONL 转换为 WebSocket 帧。已有的 `ws` 依赖负责帧处理、载荷限制和 Unix HTTP 升级。

</details>

<a id="model-experience"></a>
## 模型体验

### 原生请求

#### 模型可见内容

`turn/start` 和 `turn/steer` 将明确授权的输入传给原始 Codex 对话。调用方的工具桥返回模型可见的工具输出；本传输不添加隐藏指令。

#### Token 影响

目录和历史读取不发起模型请求。生成请求的模型选择、token 统计和原始对话历史由原生守护进程负责。

#### KV Cache 影响

原生守护进程负责构造提示词和管理缓存。本传输不重建来源提示词，也不保证缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本服务要求 Unix app-server 已运行，不启动守护进程、不发现监督进程，也不支持远程 TCP 端点。
- 协议字段随已安装的 Codex 版本变化。恢复对话不能证明已经取得其他客户端持有的活动轮次的处理权。
- `dynamicTools` 只适用于 `thread/start`，不适用于 `thread/resume` 或 `turn/start`。原生对话服务通过其独立拥有的 MCP 桥提供 Harness 工具。
- 调用方必须遵守处理取消信号，并在允许重试前显示未知结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
