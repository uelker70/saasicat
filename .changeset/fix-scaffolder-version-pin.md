---
'create-saasicat-admin': patch
'@saasicat/spec': patch
---

Fix scaffolded projects pinning a platform version that never gets published.

`templates/package.json.tpl` hardcoded `@saasicat/types` and `@saasicat/ui-vue` at `^0.1.0`. Because caret pins the minor for `0.x` versions, `^0.1.0` resolves to `>=0.1.0 <0.2.0` and would not match the published `0.2.0` — every scaffolded project would fail to install. The template now uses a `__PLATFORM_VERSION__` token that the scaffolder fills from its own `package.json` version, so the pin tracks each lockstep release automatically.

Also: ship `cli-conventions.md` in `@saasicat/spec` (the `@saasicat/cli` README links to it), point package README links at absolute GitHub URLs so they resolve on npm, and translate the scaffolder's CLI output to English.
