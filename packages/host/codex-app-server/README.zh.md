---
description: "通过原生 Host 连接已有的工作 Codex 守护进程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-codex-app-server

[English](README.md) | 中文

## Summary

`ctx.codexAppServer` 通过官方 Unix WebSocket 传输连接已有的工作 Codex 守护进程，保留原始对话标识、分页历史、运行通知、轮次控制和服务端请求。本包不创建 Harness Session，也不启动守护进程。

## Use this package

加载 Host 插件后调用 `connect()` 或 `request(method, params, signal?)`。`sourceHome` 默认为操作系统用户的 `.codex`，不依赖 `CODEX_HOME`；`socketPath` 默认为该目录下的 `app-server-control/app-server-control.sock`。初始化会核对守护进程报告的来源目录，确认后才允许对话操作。传输层不读取认证或配置文件，不启动或重启守护进程，也不访问个人 Codex 目录。

`request` 只接受声明的目录、历史、模型、对话和轮次操作。参数和结果保留官方字段名。调用方负责各方法的校验、授权、Session 投影和分页。如果浏览不应触发上游元数据修复，使用 `thread/list.useStateDbOnly: true`。恢复对话时使用 `thread/resume.excludeTurns: true` 和历史分页方法。

`onNotification` 和 `onStatus` 返回可释放的订阅。`setRequestHandler` 为批准、问题、信息收集或动态工具方法指定唯一处理方。处理方收到原始请求标识、连接代次和取消信号。请求已解决、轮次结束、连接中断或插件释放时，等待中的处理会被取消；迟到的答案不会发送。缺少处理方时，默认取消批准、拒绝权限、关闭问题或报告工具不可用。

## Understand the implementation

每个连接先执行 `initialize`，再发送 `initialized`。帧大小、输出队列和并发请求均有完整限制。请求设有期限；已经提交的修改在响应丢失、取消或超时后报告 `outcomeUnknown`，不会自动重放。后续明确请求可以重新连接，但调用方必须先恢复订阅并读取最新历史。释放时只关闭本包持有的 WebSocket，并等待关闭完成；不发送轮次中断或守护进程控制命令。

支持的消息由[官方协议](https://learn.chatgpt.com/docs/app-server)和 CLI 0.167.1 生成的类型定义。Unix 套接字需要 WebSocket 升级握手。`codex app-server proxy` 仅转发字节，不把 JSONL 转换为 WebSocket 帧。已有的 `ws` 依赖负责帧处理、载荷限制和 Unix HTTP 升级。

## Model Experience

目录和历史读取不发起模型请求。`turn/start` 和 `turn/steer` 把明确授权的模型输入交给 Codex；原生守护进程负责模型选择、token 统计和原始对话历史。工具桥返回的结果会成为原生模型可见的工具输出。

### KV-cache effect

原生守护进程负责构造提示词和管理缓存。传输层不重建来源提示词，也不添加隐藏指令。

## Known Limitations and Deferred Work

本服务要求 Unix app-server 已经运行，不负责引导启动、发现监督进程或远程 TCP 连接。协议字段随已安装的 Codex 版本变化。对于其他客户端持有的活动轮次，在单独完成验收前，不能假定恢复对话会转移请求处理权。`dynamicTools` 只适用于 `thread/start`，不适用于 `thread/resume` 或 `turn/start`；为已有对话添加 Harness 工具需要另行验证的 MCP 桥。调用方必须遵守处理取消信号，并在允许重试前显示未知结果。
