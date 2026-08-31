---
'@saasicat/ui-vue': patch
---

**The step that leads into the review reaches it again.** The plan editor navigated to `/admin/plans/review`
while the standard route table registers `plans/version/review`, so step 2 → 3 of the plan wizard
landed on the manifest catch-all in every consumer app. The editor pushes the registered path now,
and a test reads every `router.push` target out of the plan pages and refuses one the route table
does not know.
