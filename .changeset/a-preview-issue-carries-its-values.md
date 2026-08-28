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

Once an issue is said in the tenant's language, the shipped sentence has to say
as much as the English prose it replaces. Two of them did not.

`PLAN_NOT_SELF_SERVICE` read "{planKey} is not activated via self-service." —
an installation's internal key, and no hint of what to do next. Its text now
names the plan and gives the instruction the preview's prose gave, and every
site raising it carries `planName`: the catalogue name where a catalogue is
loaded, the key where the refusal is decided before one is read.

The plan-change preview's booked-bundle blocker has its own code,
`BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE`. It shared `BUNDLE_CYCLE_EXCEEDS_PLAN`
with the booking route, whose sentence states the rule for a booking nobody has
made yet — so the shared text could name neither the day the booking runs to
nor the one action that clears it. A consumer switching on
`BUNDLE_CYCLE_EXCEEDS_PLAN` in a **plan-change** preview reads the new code
instead; the booking and bundle-preview routes are unchanged.

And the language itself was the wizard's own choice rather than the app's.
`TenantPlanSectionI18n` and `PlanChangeWizardI18n` gained `issueMessages`, the
per-code texts the plan-change wizard renders its blockers and warnings from.
The wizard used to choose between the two shipped catalogues itself, so an app
adding a language through `additionalLocales` — or passing its own `i18n` map —
got its wording on the controls and German or English underneath them, with
nowhere to say otherwise. Blockers now come out of the same object as every
other string. Apps that pass a partial `i18n` need no change; one that builds a
whole map by hand adds the field, and an untranslated code still falls back
through the shipped English text to the `message` the backend sent.
