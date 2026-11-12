# Skeinlet Axiom 链接

[English](README.md) | 中文

在 Harness 会话旁打开 ChatGPT 网站中现有的 Axiom Dot 对话。此可选本地插件初始不选择网址，也不会自动打开页面。

通过 **插件 → 添加插件** 安装此目录，或让 Creator 模式使用 `plugin_manager` 的 `install_bundle` 操作安装其绝对路径。无需构建或安装脚本。此包基于随附的 Creator 装饰模板编写，并非由正在运行的 Creator 对话生成。

在会话输入框下展开 **关联现有的 Axiom 对话**，粘贴 `https://chatgpt.com/` 网址并保存。仅接受 `/dots/<id>`、`/c/<id>` 和 `/g/<id>/c/<id>` 链接；拒绝查询参数、片段、其他主机、嵌入凭据和认证路径。**在此打开 Axiom** 使用 Harness 的侧边栏浏览器；**在 ChatGPT 中打开** 使用常规浏览器。选择 **更改链接 → 移除已保存的链接** 可清除此会话的选择。

网址通过框架存储保存在当前浏览器中，按 Harness 会话分别保存，不包含凭据或对话副本。禁用或移除插件会移除其控件和语言注册。已打开的浏览器标签页仍由 Harness 管理，可正常关闭；禁用插件不会删除保存的选择。

桌面版使用独立浏览器会话，需要时请直接在 ChatGPT 页面登录。目前登录 Cookie 会在 Harness 重启后清除。网页版使用 iframe，ChatGPT 可能拒绝嵌入，此时请使用外部打开操作。嵌入式登录和 Dot 对话连续性需要在运行中的应用中验证。插件安装或标签页打开并不代表已登录或正在与 Axiom 对话。

插件不添加模型指令、工具、模型调用、对话导入、Cookie 访问或私有 ChatGPT API 调用。Dot 的身份、消息、记忆和认证仍由 ChatGPT 管理，不改变提示词令牌或 KV 缓存。

参阅[与 Dot 通信](https://learn.chatgpt.com/docs/dots/channels)了解支持的 ChatGPT 渠道。[使用 ChatGPT 登录](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)不会授权第三方应用访问 ChatGPT 会话或记忆。
