---
kind: discussion
description: "Skeinlet 本地发布范围、里程碑与验收证据。"
---
# Skeinlet 本地发布

[English](plan.md) | 中文

## 目标

交付整洁、独立品牌的 macOS 编程工作区，支持工作 Codex 登录、已有 Codex 聊天展示、工具与审批，以及可选的真实 Axiom 入口。保留当前本地 Harness 会话和凭据，关闭报告，构建并安装本地应用，不推送、不创建 PR、不对外发布。

## 里程碑

1. 品牌已完成：Skeinlet 原生应用、原创生成的位图图标、SVG 标记和字标、欢迎页及浏览器品牌、独立 bundle 标识与 URL scheme。保留 MIT 许可证和上游署名。名称是工作名称，不声称完成商标审查。
2. Codex 聊天已完成：独立只读库提供标题搜索、归档筛选、消息分页和工作主目录来源标记。读取私有 SQLite 快照，不恢复、改写或导入源聊天，不读取个人 Codex 或认证文件，不加载远端图片和原始 HTML。
3. Axiom 插件已完成：可选 `@local/skeinlet-axiom-link` 0.1.1 通过桌面侧边栏浏览器打开用户选择的真实 ChatGPT Dot，并提供外部浏览器入口。插件基于 Creator 模板编写，在用户运行的 Creator 聊天中审查，并根据审查和原生视觉检查改进。不创建替代人格，不复制 Cookie，不使用私有 ChatGPT API。
4. 本地发布已完成：独立 Apple Silicon 应用安装于 `~/Applications/Skeinlet.app`，保留现有本地配置，省略更新源，内嵌运行时，验证常规冷启动和界面注册，并在本地提交。它是临时签名的本地候选版，未经公证或对外分发。

## 编程工作流对照

| 工作流 | 现有实现 | 发布动作 |
|---|---|---|
| 项目和聊天 | 工作区、搜索、归档和分支 | 保留，新增工作 Codex 聊天库 |
| 终端、工具和审批 | PTY 标签页、工具执行和审批卡片 | 保留，检查运行时 PTY 和实际 Creator 工具 |
| Git 和 worktree | 可选 Forge 集成 | 复用现有集成 |
| 子代理和自动化 | Harness 原生服务 | 保留已有入口 |
| 原始 Axiom 连续性 | 真实 ChatGPT Dot 页面 | 可选链接插件，需要单独登录 ChatGPT 网站 |

## 验收

本地产物构建及 Host/Client 汇总类型检查通过。重点检查覆盖源数据库保留与分页、资源和插槽卸载、Markdown 图片禁用、品牌、原生打包、CLI 转发和 OAuth 冷启动。组装浏览器测试通过聊天历史、提供方授权及 Axiom 安装、导航和卸载场景。仓库文档套件的 43 项检查全部通过。

原生运行时通过隔离的 CLI 插件安装与移除、PTY、搜索、原生依赖和 Office 文档往返检查。安装的应用通过严格深度签名校验，并能在不依赖检出目录启动器或开发参数的情况下正常冷启动。本地包依赖约束及改动文件 lint 通过。这些属于本地检查，不等同于 CI 或公开发布验收。

## 当前证据

2026-11-12，Computer Use 展示了 `~/.codex` 中真实工作目录和已有聊天正文，提供只读来源标记、旧消息分页且不显示输入框。当前聊天使用 `thread_history_1.sqlite`，只扫描 JSONL 会遗漏它们。合成数据库测试验证源 DB/WAL 不变且不创建源 SHM。Codex 自身并发写入不属于此查看器的行为。

现有 Creator 聊天通过保存的工作 Codex 订阅完成只读插件审查。凭据文件在安装和重启后字节一致。最终冷启动识别提供方授权，直接进入保留的工作区。运行时元数据确认会话 OTel、产品 OTel 和客户端分析均禁用且未挂载。Axiom 链接在重启后保留在本地，私有 URL 不进入源码或发布产物。

已在登录的工作浏览器中找到真实 Axiom 页面。安装的插件在原生侧边栏浏览器打开相同目标并到达 ChatGPT 登录页。嵌入式认证及登录后的 Axiom 回复仍需用户验收。临时测试标签页已关闭，应用已隐藏以恢复用户焦点和布局。

## 限制与复现

源库展示受支持的本地分页文字历史，不恢复 Codex 聊天，不同步远端历史，不复制附件、工具输出或推理，也不声称完全达到 Codex 桌面功能等同。未来 Codex SQLite 格式改变时可能需要更新读取器。Dot 连续性、认证和用量规则由 ChatGPT 管理；侧边栏浏览器 Cookie 当前仅保留至应用重启。可选网站及模型提供方仍遵循自身网络策略。

使用 `pnpm --dir apps/desktop run package:local-fork --dir` 重建。输出位于 `apps/desktop/.desktop-build/targets/mac-arm64/unsigned-artifacts/mac-arm64/Skeinlet.app`。内嵌运行时 CLI 仅在应用完全退出时管理 desktop 配置。使用该 CLI、现有本地 `DSH_HOME` 和 `dsh plugin --profile desktop add <tarball> --ignore-scripts --offline` 安装可选插件 tarball。

原生壳有意保留 `~/Library/Application Support/DeepSeek Harness Local` 下的 Electron 与 Harness 数据。替换为其他 Skeinlet 构建时保留此配置。工作 Codex 源仍为 `~/.codex`，个人 Codex 独立。上游 Harness 更新不会替换此应用；未来源码合并仍需重复上述隐私和登录检查。

原创图形和生成提示词位于 `assets/branding/skeinlet/`：`app-icon.png`、`mark.svg`、`wordmark.svg` 和 `prompt.txt`。打包图标是内置 ImageGen 原始输出的 1024px 技术缩放版。
