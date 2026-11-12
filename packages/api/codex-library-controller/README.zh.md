---
kind: package-reference
description: "读取已有工作 Codex 聊天标题和可见消息，不启动模型、不修改源文件。"
---

# @deepseek-ai/dsh-api-codex-library-controller

[English](README.md) | 中文

<a id="summary"></a>
## 概述

读取已有工作 Codex 聊天标题和可见消息，不启动模型、不修改源文件。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

`sourceHome` 默认为操作系统用户的 `.codex`，独立于 `CODEX_HOME` 和 Harness 主目录。显式绝对路径可选择其他工作安装。`codexLibrary` Remote 命名空间仅提供 `list` 和 `read`，调用权限仅限所有者。

每次查询前，将数据库和可选 WAL 克隆到私有目录。绝不通过 SQLite 打开源数据库，也不复制其共享内存文件。复制前后的源元数据必须稳定，最多尝试三次。拒绝符号链接、活动回滚日志和超过 2 GiB 的源。SQLite 仅以只读方式打开私有副本，禁用扩展并启用 `query_only`；每次查询后删除私有文件。

目录最多返回四十个标题，支持字面量搜索和归档过滤。记录页按时间顺序显示最多四十条用户或助手文字，包含元数据的响应最多 512 KiB。超过 128 KiB 的单条消息会被省略并提示。ID 仅用于 SQL 参数，不是文件路径。工具输出、推理、附件、认证和配置均排除。

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
