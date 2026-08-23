---
'@saasicat/ui-vue': patch
---

**`runAdminPagesSuite` finds the dashboard distributions again.** Phase 4 replaced the dashboard's
hand-rolled distribution rows with `AdminSection`, and the shipped Playwright suite kept asking
for the old `.sa-dashboard__row-head h2` — so every consumer with `expectedDistributionTitles`
failed the dashboard test against 1.0 with "Distribution '…' missing" while the page rendered it.
The selector is one exported constant now, and a component test asks the suite's question of the
mounted page, so the two cannot drift apart unseen again.
