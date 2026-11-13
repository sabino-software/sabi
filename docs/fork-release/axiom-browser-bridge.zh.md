# 原始 ChatGPT 浏览器桥接

[English](axiom-browser-bridge.md) | 中文

可选的 Sabi 扩展连接用户常用 Edge 或 Chrome 配置中的一个指定 ChatGPT Dot。Google 和 ChatGPT 登录始终由该浏览器管理。安装核心版检查已确认应用内 ChatGPT 认证及原生 Dot 发送。常规浏览器扩展对实际原始 Dot 的输入仍待实时验收。仅在尚无设置时默认使用内嵌登录。明确选择浏览器或内嵌方式后，选择会保存到现有应用配置中，在更新或重启后保留；标签页配对仍仅限当前运行。扩展读取已渲染消息并使用网站原有输入框，不读取 Cookie、浏览器存储、登录页面、隐藏历史或网络响应。

## 检查准备好的文件

本地 macOS 分支打包将文件放在 Sabi.app 内的 `Contents/Resources/runtime/axiom-browser/`。`extension/` 是未打包的 Manifest V3 扩展；`native-host.sh` 使用已安装应用自带的 Node 运行时，无需源码或系统 Node。`registration.mjs` 仅输出原生消息主机配置，不会安装它。桌面预加载接口 `axiom.browserSetup()` 返回文件路径、可用性、扩展 ID 和权限，供设置界面预览。

固定扩展 ID 为 `kbmcpehehgohghdkbamffnepndemabkd`，公钥位于 `extension/manifest.json`。权限仅为 `activeTab`、`scripting` 和 `nativeMessaging`，不申请 Cookie、调试器、网络拦截、剪贴板或广泛网站权限。通信和临时标签页访问采用 [Chrome 原生消息 API](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) 与 [activeTab API](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)。

## 用户明确执行的本地设置

以下步骤需要用户安装，构建和设置预览不会自动执行：

1. 在预期的工作 Edge 或 Chrome 配置中打开扩展管理页面，启用开发者模式，选择“加载已解压的扩展”，并指定已安装应用的 `runtime/axiom-browser/extension` 目录。确认显示的扩展 ID 与上述 ID 相同。
2. 针对实际应用安装位置生成并检查原生主机配置。例如，应用位于 `~/Applications` 时运行以下命令；先将输出保存到审核文件，不要直接安装。

```sh
"$HOME/Applications/Sabi.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  "$HOME/Applications/Sabi.app/Contents/Resources/runtime/axiom-browser/registration.mjs" \
  --app "$HOME/Applications/Sabi.app"
```

3. 检查后，将 JSON 以 `dev.sabino.skeinlet.axiom.json` 文件名安装到目标浏览器的用户级 `NativeMessagingHosts` 目录。Chrome 文档给出的目录为 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`；Edge 使用对应的 Microsoft Edge 目录。配置只允许固定扩展来源，并指向该应用的辅助程序。移动应用后需重新生成配置。没有自动安装器。
4. 在 Sabi 中选择浏览器连接模式，并使用顶部专用 Dot 按钮选择原始对话。在目标常规浏览器配置中正常登录并打开同一 Dot。点击扩展工具栏按钮，批准标明所选 Dot 的原生提示。保持标签页打开；仅此标签页的主文档会配对。

现有“打开 ChatGPT”操作仅在已配对标签页仍显示指定 Dot 时聚焦该标签页。若已跳转到其他页面，操作会明确失败，不会聚焦无关页面；请在浏览器中手动完成登录并返回指定 Dot。配对前只会在默认浏览器中打开指定的规范 Dot 网址。重新加载或跨来源登录后，需再次点击扩展，为新文档授权并配对。断开 Sabi 不会关闭标签页或退出网站登录。

## 数据和输入限制

辅助程序使用有长度上限的 JSON 帧和私有应用套接字。套接字目录权限为 0700，套接字和应用描述文件为 0600。每次运行的本地能力值验证辅助程序，该值不会传给网页或扩展内容脚本。原生确认绑定指定 Dot、标签页 ID 和文档 ID。协议仅支持快照、准确文本发送和聚焦，不支持任意脚本、网址请求或导航。

内容脚本复用现有安全 Markdown 读取器和固定输入框选择器。发送需同时满足观察版本一致、原始草稿为空、浏览器 `execCommand('insertText')` 成功、输入内容完全一致、网站实际发送按钮可用，以及出现匹配的新用户消息 ID。插入后最多等待两秒，让真实编辑器启用发送按钮；已插入的草稿或编辑器发生变化时会拒绝发送。编辑器拒绝插入时保留草稿并拒绝发送，不会切换为调试器或其他受信输入方式。已确认或结果不确定的消息不会自动重发。套接字关闭仅表示连接丢失，不证明浏览器中已派发的动作已经停止；需要先检查原始对话。近期结果会缓存，旧请求 ID 会被拒绝。受控浏览器测试只证明固定测试页面上的编辑流程，实际登录 Dot 的兼容性仍须通过现场验收。

快照仅包含有大小上限的已渲染消息窗口。文本大小限制优先保留最新的已渲染消息，再按来源顺序返回，避免较长的旧消息遮蔽刚发送的内容或最新回复。网站可能虚拟化旧消息、调整选择器、限制后台标签页或拒绝编辑命令。这些情况会停止或拒绝操作，不会改用未公开 API 或生成虚假的助手回复。
