---
description: "提供商授权 Remote 交互和浏览器登录状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-authorization-controller

[English](README.md) | 中文

## 概述

本包把已注册的授权流程连接到 Models 设置页面。Host 拥有交互流，浏览器拥有发起交互的界面及脱敏状态。提供商插件继续负责 OAuth、凭据提交和令牌刷新。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 `authorization`、`credentials` 和 `typert` 旁挂载默认 Host 插件，在生成的 `authorization` Remote 命名空间旁挂载 `/client`，并把 `/remote` 加入 API 组合。浏览器服务为 `ctx.providerAuthorization`。

`list` 返回已注册的方法、是否正在尝试登录，以及凭据记录是否已保存和是否可写。它从不读取或返回凭据内容。已保存记录不保证订阅或令牌有效。

`begin` 以完整帧传输通知、问题和终态。尝试标识用于调用 `answer` 和 `cancel`；每个问题还有独立标识，因此浏览器回调撤回问题后，迟到的回答会被拒绝。关闭流会取消尝试并等待结算。连接中断不会静默启动新的 OAuth 尝试。`cancel` 等待授权服务已准入的凭据提交完成。

`logout` 仅删除已注册流程在本应用中的凭据记录，流程运行期间拒绝删除。它不会撤销提供商会话或退出其他应用。单次调用拒绝保留提供商异常作为进程内原因；流仅暴露终态，不携带异常文本，回答也不会保存在快照中。

<a id="model-experience"></a>
## 模型体验

无，因为本包不提供模型提示词、工具或 Session 事件。

#### KV 缓存影响

无。授权交互不改变模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 浏览器断开连接后，无法仅通过流确定凭据提交是否完成；它会刷新已保存的记录状态，并报告中断。提供商使用凭据时检查令牌有效性。刷新后可看到其他浏览器中正在进行的登录；本包不会在浏览器之间转移问题。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

Host 将 OAuth 密钥保留在提供商拥有的凭据存储中；浏览器仅接收脱敏视图。

</details>
