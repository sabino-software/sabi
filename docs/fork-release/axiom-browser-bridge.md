# Original ChatGPT browser bridge

English | [中文](axiom-browser-bridge.zh.md)

The optional Skeinlet companion connects one selected ChatGPT Dot in the user's regular Edge or Chrome profile. Google and ChatGPT sign-in remain in that browser. Embedded Google navigation is fixed, but completed SSO remains unverified; companion input against the actual original Dot also awaits live acceptance. Embedded sign-in is the default only when no preference exists. An explicit **Browser** or **Embedded** choice is saved in the preserved app profile and survives update or restart; pairing itself is runtime-bound. The extension reads rendered messages and uses the page's real composer. It does not read cookies, browser storage, authentication pages, hidden history or network responses.

## Review the prepared artifacts

Local-fork macOS packaging prepares `Contents/Resources/runtime/axiom-browser/` inside Skeinlet.app. The `extension/` directory is the unpacked Manifest V3 extension; `native-host.sh` uses the installed application's bundled Node runtime, without a checkout or system Node. `registration.mjs` prints a native-host manifest and never installs it. The desktop preload's `axiom.browserSetup()` returns the artifact paths, availability, extension ID and permissions for the setup preview.

The pinned extension ID is `kbmcpehehgohghdkbamffnepndemabkd`. Its public key is in `extension/manifest.json`. Permissions are exactly `activeTab`, `scripting`, and `nativeMessaging`. There is no `cookies`, `debugger`, `webRequest`, clipboard or broad host permission. Native messaging and temporary tab permissions follow [Chrome's native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) and [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) APIs.

## Explicit local setup

These are user installation steps, not actions performed by a build or the setup preview:

1. In the intended **work** Edge or Chrome profile, open the extensions page, enable Developer mode, and choose **Load unpacked**, selecting the installed app's `runtime/axiom-browser/extension` directory. Verify the displayed ID matches the pinned ID above.
2. Generate and review the native-host manifest for the actual installed path. For example, with an app under `~/Applications`, run the following command; redirect its output only to a review file first.

```sh
"$HOME/Applications/Skeinlet.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
  "$HOME/Applications/Skeinlet.app/Contents/Resources/runtime/axiom-browser/registration.mjs" \
  --app "$HOME/Applications/Skeinlet.app"
```

3. After reviewing it, install that JSON as `dev.sabino.skeinlet.axiom.json` in the intended browser's user-level `NativeMessagingHosts` directory. Chrome documents `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`; use the corresponding Microsoft Edge directory for Edge. The manifest allows only the pinned extension origin and points to this installed app's helper. Moving the app requires regenerating this registration. No installer runs automatically.
4. In Skeinlet, choose the browser transport and connect the exact Dot URL. Sign in normally in the regular browser and open that exact Dot. Click the extension toolbar action. Approve the native prompt naming the exact selected Dot. Keep the tab open. Only this tab's main document is paired.

The existing **Open ChatGPT** action focuses the paired browser tab only while it still displays the exact selected Dot. If that tab navigated elsewhere, the action fails explicitly without focusing an unrelated page; finish browser sign-in and return to the selected Dot manually. Before pairing it opens only the selected canonical Dot in the default browser. After a reload or cross-origin sign-in, click the extension again to grant access and pair the new document. Disconnecting Skeinlet revokes its connection; it does not close the tab or sign the user out.

## Data and input limits

The helper uses Chrome's bounded length-prefixed JSON protocol and a private app socket. The socket directory is mode 0700, the socket and app descriptor are mode 0600, and a per-run local capability authenticates the helper. The capability is never sent to a webpage or extension content script. A native confirmation binds the selected Dot, tab ID and document ID. The protocol accepts only snapshot, exact-text send and focus operations, without an arbitrary script, URL fetch or navigation operation.

The content script shares the existing sanitized Markdown reader and fixed composer selectors. Sending requires the observed revision, an empty original draft, successful browser `execCommand('insertText')`, exact composer text, an enabled real Send button and a new matching original user message ID. A rejected editor insertion preserves the draft and refuses; there is no debugger or trusted-input fallback. Confirmed and uncertain submissions are not resent. Socket closure means connection loss, not proof that already-dispatched browser input has stopped; inspect the original conversation before continuing. Recent outcomes are cached; retired request IDs are refused. A browser fixture proves the editing path on controlled markup, not compatibility with the live ChatGPT editor. Live acceptance must verify the actual signed-in Dot before claiming that sending works there.

Snapshots contain only the bounded rendered window. Text limits retain the newest rendered messages first and return them in source order, so long earlier messages cannot hide the latest send or reply. The site can virtualize older messages, change selectors, throttle background tabs or reject automated editor commands. Such failures stop or refuse the operation; they do not fetch an undocumented API or synthesize an assistant reply.
