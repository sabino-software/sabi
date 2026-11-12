# Skeinlet Axiom link

English | [中文](README.zh.md)

Open your existing Axiom Dot conversation on the real ChatGPT website beside a Harness session. This optional local plugin starts with no selected URL and never opens a page automatically.

Install this directory with **Plugins → Add plugin**, or ask Creator mode to install its absolute directory through `plugin_manager` with `action: install_bundle`. No dependency installation scripts or build step are needed. This package follows the shipped Creator decoration template; it was authored outside the running Creator conversation.

In the conversation composer dock, expand **Link your existing Axiom conversation**, paste its `https://chatgpt.com/` URL, and select **Save link**. Only `/dots/<id>`, `/c/<id>`, and `/g/<id>/c/<id>` links are accepted. Queries, fragments, other hosts, embedded credentials, and authentication routes are refused. **Open Axiom here** uses Harness's existing Sidebar Browser; **Open in ChatGPT** opens the same URL in your usual browser. **Change link → Remove saved link** clears this session's saved selection.

The selected URL is browser-local viewing state, stored separately for each Harness session through the framework store. It is not a credential or a copy of the conversation. Disabling or removing the bundle removes its controls and locale registrations. An already-open Browser tab remains owned by Harness and can be closed normally; disabling the plugin does not delete the saved selection.

Desktop uses its own browser session: sign in directly on ChatGPT if requested. Its cookies currently disappear when Harness restarts. Web deployments use an iframe, which ChatGPT may refuse; use the external action if opening inside fails. Embedded ChatGPT login and Dot conversation continuity require verification in the running application. An installed plugin or an opened tab does not establish that you are signed in or speaking with Axiom.

The plugin adds no model instructions, tools, model calls, conversation imports, cookie access, or private ChatGPT API calls. ChatGPT owns the Dot, its identity, messages, memory, and authentication. No prompt-token or KV-cache change is introduced.

See [Message your dot](https://learn.chatgpt.com/docs/dots/channels) for supported ChatGPT channels. [Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt) does not grant third-party apps access to ChatGPT conversations or memories.
