# Original Dot page adapter

English | [中文](axiom-native-bridge.zh.md)

The desktop bridge projects the user-selected original `https://chatgpt.com/dots/<id>` page into native Harness controls. It uses a dedicated persistent Electron session, without copying browser cookies, reading token storage, calling a private ChatGPT API, or replacing the Dot with a model request. The original website owns the conversation and authentication. **Show original page** reveals that website for direct login or interactions the native projection cannot represent.

Only rendered user and assistant `.message-text` elements are projected. The adapter preserves their original IDs, roles, timestamps and supported Markdown formatting. It excludes actions, quoted replies outside the body, scripts, hidden nodes, and automatic image loading. The projection contains at most 100 rendered messages and bounded text. It does not claim to expose unloaded or virtualized history. Website status text is shown as observed; the existence of a typing indicator alone does not imply activity.

Sending requires an explicit native user action. The adapter refuses to replace a nonempty original draft, inserts the exact text through Electron input, verifies it, and clicks the real enabled Send control. The original site decides whether submission can queue while the Dot works. Confirmation requires a new original user-message ID with matching text. Ambiguous submission is reported without automatic retry; request IDs suppress duplicate clicks during the application process. Original DOM changes can make the adapter unavailable instead of producing synthetic content.

The bridge admits the selected Dot URL, ChatGPT authentication routes, and `https://auth.openai.com`. It permits the ChatGPT landing page only as a return from an observed authentication flow; other destinations are blocked. Login and streaming acceptance require checks against the running original page; fixture selectors alone do not establish them.
