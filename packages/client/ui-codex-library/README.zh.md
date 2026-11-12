---
kind: package-reference
description: "侧栏的 **Codex 聊天** 入口在独立只读聊天库中显示已有工作会话。"
---

# @deepseek-ai/dsh-client-ui-codex-library

[English](README.md) | 中文

<a id="summary"></a>
## 概述

侧栏的 **Codex 聊天** 入口在独立只读聊天库中显示已有工作会话。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Codex 聊天库 API 和标准浏览器服务旁挂载此 UI。搜索标题字面片段，切换当前或归档状态，选择标题，再分页查看更早的可见消息。刷新会重新读取源。源目录始终显示在列表上方。

源聊天没有输入框，绝不会导入 Harness 历史、恢复运行或发送给模型。Markdown 省略原始 HTML 和图片，查看源消息不会自动获取外部图片。窄屏可用“所有聊天”返回目录。

[API 所有者](../../api/codex-library-controller/README.zh.md)说明源选择、私有快照、读取限制和兼容性。

<a id="model-experience"></a>
## 模型体验

无，因为本包不添加模型提示词、工具或请求。

#### KV 缓存影响

不影响模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 仅支持当前分页 SQLite 格式，旧式 rollout 记录和远端会话不在本版范围内。数据库文件名和字段随 Codex 更新可能不兼容；此时显示不可用，而不重写来源。刷新后显示更新，没有后台轮询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

来源数据只用于显示。

</details>
