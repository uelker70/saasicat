---
'@saasicat/nest': patch
'@saasicat/spec': patch
---

`POST /admin/billing/plan-catalog/import` answers **400** for a body it could
not read, where it previously answered 500.

Unparseable YAML and a schema or cross-field violation both reached Nest as
plain `Error`s, so a caller could not tell a bad upload from a broken server —
and the one they could fix was the one that looked unfixable. They now carry
`PLAN_CATALOG_UNREADABLE` and `PLAN_CATALOG_INVALID` — both in
`CATALOG_ERROR_CODES` with English and German text, so `resolveErrorMessage`
answers them like every other coded error instead of falling through to a raw
validator dump. A failure from the store keeps its 500, which is the honest
status for it.

The OpenAPI contract also had the first-run setup statuses wrong: `POST /setup`
answers 401 for a wrong token, 409 once a SUPER_ADMIN exists, 400 for an
unusable email and 403 only when `SETUP_TOKEN` is unset. It documented 403 for
all of them.
