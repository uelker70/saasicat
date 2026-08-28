---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

Plan change preview issues are now translatable

The blockers and warnings a plan change preview returns used to be English
sentences with their numbers already baked in — "Current usage 11 exceeds the
target limit 5 (vehicles)". They travel in a 200 response, so no error handling
could reach them, and a tenant read them in English whatever language they had
chosen. No client could rebuild the sentence, because the values existed only
inside it.

Every issue now carries a code from `BILLING_ERROR_CODES` and the values it
talks about in `params`, and both catalogues carry the text. Three codes that
were constructed per case collapsed into one each with a parameter:
`QUOTA_OVER_TARGET` takes the quota key, `PLAN_LOCKED` and
`PLAN_NOT_SELF_SERVICE` needed none. `PlanChangePreviewIssue` gained the
optional `params` field, and `@saasicat/ui-vue` exports
`PlanChangePreviewIssueShape` for consumers rendering the list themselves.

`resolveErrorMessage` accepts a body whose `code` is any string, so a consumer
can pass an issue through the same ladder as every other coded failure without
casting: their own catalogue, the shipped one for the active locale, then the
English message the backend sent, then the bare code. Interpolation reads
`params` first and the top-level body second.

Rendering an issue's `message` directly still works and still returns English.
Consumers who want the tenant's language read `code` and `params` instead —
`examples/notesapp` shows the seam.
