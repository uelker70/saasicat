---
'@saasicat/spec': patch
---

The SuperAdmin OpenAPI contract now describes the routes that exist.

`admin-api.openapi.yaml` had drifted from the reference implementation in both
directions. Corrected:

- `GET /dashboard/stats` is `GET /stats/dashboard` — the path every client
  already calls. If you implemented the documented one, it was never reached.
- Removed `/plans`, `/plans/reload` and `/plans/last-update` (the plan catalog
  is imported through `POST /billing/plan-catalog/import` and read through
  `/catalog/plans`) and `/mfa/setup`, `/mfa/confirm` (admin MFA enrolment runs
  through the CLI and first-run setup). Nothing served any of them.
- Added the five operations the platform serves and the document omitted:
  `GET /setup/status`, `POST /setup`, `POST /setup/confirm-mfa`,
  `GET /subscriptions`, `POST /billing/plan-catalog/import`.
- Operations your application serves rather than the platform — tenant
  lifecycle, user administration, the promo-code detail view — now carry
  `x-served-by: app` and say why.

`info.version` follows the release instead of standing at `0.1.0-draft`, and a
repository test holds the document against the controllers from now on.
