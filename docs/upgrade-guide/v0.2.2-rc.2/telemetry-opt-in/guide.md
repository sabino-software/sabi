---
kind: upgrade-guide
description: "Shipped profiles stop uploading analytics, feedback history, Session logs, and plugin inventories by default."
---
# Telemetry requires explicit opt-in

## Change

Shipped profiles leave Session OTel, DeepSeek Session-log and plugin-inventory reporting, and Desktop product analytics unmounted. Their collection policies also default to disabled. Recording feedback remains local. Existing local sessions, diagnostics, model calls, and requested network tools continue working.

## Migration

No action is required to keep reporting disabled. Existing profile or home patches that explicitly enable reporting retain their normal precedence; remove those opt-ins for the private defaults.

Deployments that require reporting must opt into each independent path:

1. In the profile's `cordis.patch.yml`, set `disabled: false` on the desired reporting row.
2. Set `enabled: true` for `session-log-deepseek`, `plugin-package-inventory-deepseek`, or `product-analytics`. Product analytics also requires the `desktop-product-telemetry` row and a service version.
3. For `session-telemetry-otel`, explicitly configure `mode: FEEDBACK_ONLY` and `exporter.url`; environment variables alone no longer enable the shipped row. See its [configuration reference](../../../../../packages/session/session-telemetry-otel/README.md).
4. Confirm the intended rows are enabled in the Plugins view and verify delivery against your own collector. A feedback acknowledgement confirms local recording only.
