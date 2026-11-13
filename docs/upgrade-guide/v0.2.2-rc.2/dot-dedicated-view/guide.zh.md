---
kind: upgrade-guide
description: "Dot 对话退出普通 Harness Session 发现入口，改用专用连续视图。"
---

# Dot 改用专用视图

[English](guide.md) | 中文

## 变更

ChatGPT Dot/Axiom 不再作为普通 Harness Session、模型提供方、历史搜索结果、归档条目或置顶聊天出现。已有镜像日志及持久化读取器代际不变。Codex 和普通 Session 保留既有行为。旧 `nativeConversations.connectAxiom(url)` 响应由 `{ sessionId }` 改为 `{ url, phase }`，不再创建 Session。

## 迁移

1. 通过顶部 Dot 按钮在专用视图中使用原始对话。已有网站认证和标识仍由桌面页面桥接拥有。
2. 客户端集成在保留旧的已保存标识前须查询 `session.presentation({ sessionId })`。隐藏结果应通过通用 `route` 分派，不得作为普通聊天打开。Dot 路由为 `{ view: "dot", params: { url } }`。
3. 移除 `connectAxiom` 返回 Session 标识的假设，改用专用桌面 Dot 选择及快照/发送接口；保留已有日志和来源记录。
4. 确认旧 Dot 镜像不出现在活动、归档、置顶和搜索结果中，旧保存链接打开 Dot。确认普通聊天或 Codex 聊天仍能正常打开。
