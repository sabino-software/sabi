---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-12-native-authored-times

[English](2026-11-12-native-authored-times.md) | 中文

## 概述

导入原始 Codex 和 Axiom 消息时保留作者时间，不改变接收时间或 Session 顺序。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-12-native-authored-times
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-27-retry-control-input"
    after: "d5523a8a468194a181adc3b48993f59facefaef2fbab5d3211275bdd4913e1e3"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "a4eeab4066b8ac256303ef6b2a5a96cad8ce27e643328c82dfd84a22777c82a9"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "14538a9a7f0e63a947829b0ed947a6c34f5c6e1eabab06abf45b503374853c66"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "a75d3e68aa057eaaffd19a6138c24e3e10a9b17ccf0d753f4c48720cc35d4306"
    decision: same-version
  - root: "event:system/message"
    previous: "2026-09-16-session-format-v4"
    after: "c23657c6f53abb23f432c6c3aba0d2417c9146abe94142f4bc086a20327b41b8"
    decision: same-version
  - root: "event:tool/result"
    previous: "2026-09-16-session-format-v4"
    after: "c06182cd8d9b3fe07a1dda3f54c246fae8198de9c3628134a3c5de75b6a32f55"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "03d511bcc115ae2e6175de46ede985f139609b2d408b9596c0329f070445355a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

保持 Session 格式版本不变：authoredAt 是现有消息载荷中的可选信息字段，不新增事件外层字段。旧消息没有此字段，继续使用接收时间；导入消息记录来源的毫秒时间，来源未知时显式记录 null。已验证修改前构建的 Session 读取器保留新增用户消息字段和原接收时间。新读取器在追加与恢复时验证作者日期，消息身份、来源、正文、序号和模型回放语义不变。侧栏来源时间标记是缓存投影中的可选字段，其 stateVersion 增加以重新计算。此更改不会修复此前已导入的本地镜像。

<a id="verification"></a>
## 验证

集成后的限定测试共 127 项通过，覆盖核心追加验证、原始历史导入、Host 作者时间投影和排序、Axiom 渲染及会话节点。客户端列表作者时间回归测试也通过。类型感知限定检查通过。修改前构建的 Session 读取器通过内存兼容性验证并保留新字段。持久化清单、模式确认和格式检查独立执行；此更改不会修复此前已导入的本地镜像。

<a id="dev-note"></a>
## 开发备注

无。
