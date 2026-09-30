---
'@saasicat/ui-vue-tenant': minor
---

Offer a newer version of the plan beside it, and switch to it

`TenantPlanSection` reads `GET billing/version-offer` and, where a newer
version of the tenant's plan is offered, shows it beside the plan: a card with
both versions side by side — the net price in each rhythm, each quota, the
features added and removed — the kind of offer and when a switch would take
effect. There is nothing to decline and no deadline; the card says the current
version stays as long as the tenant does not switch.

- An improvement is taken by one click. More for more and one that takes
  something away ask first, and say what the switch does: charged the prorated
  difference where the rhythm gets dearer, or taking effect at the term end.
- The page states the outcome — switched now, or scheduled for a date — and
  the plan card names a scheduled switch as a new version rather than as a
  change to the same plan.
- A refusal is shown in the app's language through `issueMessages`. Where the
  offer moved in the meantime, the card shows the one that now stands.
- New catalogue keys: `versionOffer*` and `pendingVersionSwitch`, in the
  German and English defaults. An app that passes its own full `i18n` map adds
  them.
