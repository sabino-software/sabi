---
kind: upgrade-guide
description: "随附 profile 默认停止上传埋点、反馈历史、Session 日志和插件清单。"
---
# 遥测需要显式启用

[English](guide.md) | 中文

## 变更

随附 profile 不挂载 Session OTel、DeepSeek 会话日志和插件清单上报以及 Desktop 产品埋点。对应采集策略也默认禁用。反馈记录保留在本地。本地会话、诊断、模型调用和按需网络工具继续可用。

支持链接不再附加账号、构建、设备、时区或屏幕标识。账号设置和桌面启动配置中的 `contactSource` 选项已移除，请从自定义补丁中删除。

原生 Codex、Claude Code 及可选 OAR 子运行时均使用各自支持的分析、错误上报和 OpenTelemetry 禁用选项启动。模型请求和明确调用的工具仍会使用网络。

## 迁移

保持上报禁用无需操作。现有 profile 或 home patch 中显式启用上报的配置保留正常优先级；移除这些启用项即可使用隐私默认值。

需要上报的部署必须分别启用独立路径：

1. 在 profile 的 `cordis.patch.yml` 中，为所需上报行设置 `disabled: false`。
2. 为 `session-log-deepseek`、`plugin-package-inventory-deepseek` 或 `product-analytics` 设置 `enabled: true`。产品埋点还需要 `desktop-product-telemetry` 行和服务版本。
3. 对于 `session-telemetry-otel`，显式配置 `mode: FEEDBACK_ONLY` 和 `exporter.url`；仅设置环境变量不再启用随附行。参阅其[配置参考](../../../../packages/session/session-telemetry-otel/README.zh.md)。
4. 在插件视图中确认目标行已启用，并通过自己的接收端验证投递。反馈确认文本仅确认本地记录。
