---
description: "以只读方式浏览已有的工作 Codex 对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-codex-library

[English](README.md) | 中文

## Summary

通过侧边栏的 **Codex 对话** 查看已有工作对话的标题和可见消息记录。页面明确标注来源目录。本包不提供修改来源、恢复运行、生成内容或访问认证信息的操作。

## Use this package

在桌面 profile 中加载 Host 插件。`sourceHome` 默认为操作系统用户的 `.codex` 目录，不依赖 `CODEX_HOME` 或应用自身的存储目录。也可以明确指定工作安装的绝对目录。浏览器入口通过已有注册机制添加主面板和侧边栏图标。

搜索按标题片段进行不区分大小写的字面匹配。当前和已归档对话分开显示。**下一页对话** 读取下一页目录。选择标题后读取最新的可见消息；**更早的消息** 读取上一页历史，**最新消息** 返回最新一页。刷新会重新读取来源。浏览不会把来源对话变为可编辑的 Harness Session。

## Understand the implementation

Host 使用 `readOnly: true`、SQLite `query_only`、禁用扩展以及 500 毫秒忙等待超时，打开已有的 `state_5.sqlite` 和 `thread_history_1.sqlite` 文件。数据库文件不能是符号链接。对话标识始终作为 SQL 参数处理，不作为文件路径。不启动 Codex 可执行文件，也不读取来源配置、凭据、rollout 文件或个人目录。

目录每页最多四十条。消息每页最多四十条用户或助手文字，按时间顺序显示并保留来源时间戳。每页消息响应包含元数据在内最多 512 KiB。超过 128 KiB 的消息会跳过并显示提示。游标和查询输入均经过长度限制和校验。来源数据损坏或不兼容时，页面显示经过清理并本地化的重试提示。

浏览器使用已注册的资源提供者和共享 Markdown 渲染器。工具输出、推理、附件及系统或开发者指令不显示。此查看器直接读取本地 SQLite，因为文档中的 [app-server 目录操作](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters) 可能扫描并修复来源元数据。

## Model Experience

不增加模型可见输入、工具或模型请求。浏览不消耗模型 token。

### KV-cache effect

无。来源消息只用于显示，不进入代理提示词或 Session 日志。

## Known Limitations and Deferred Work

读取器支持当前的分页 SQLite 历史格式。仅有旧版 rollout 的对话会显示记录不可用提示，不会被静默导入或恢复运行。SQLite 文件名和字段与版本有关，未来不兼容的 Codex 版本可能使来源不可用。各页独立读取，不构成跨数据库的实时快照。来源更新在刷新后显示，不进行后台轮询。英文、中文和葡萄牙文以外的语言使用英文回退。远程 Markdown 图片遵循共享渲染器策略。
