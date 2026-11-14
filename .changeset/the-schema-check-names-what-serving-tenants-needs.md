---
'@saasicat/cli': patch
'@saasicat/core': patch
---

The schema check names what an application serving tenants cannot run without

`saasicat schema check` no longer lists the models a start with `tenantBilling`
on cannot do without under "Not adopted", as not an error. It names them in a
section of their own, "Needed wherever tenantBilling is on", each with the start
rule that refuses a start with nowhere to keep its records: `TenantAccessHold`,
`SubscriptionEnd`, `SubscriptionEndAnnouncement`, `TenantExportDownload` and
`SubscriptionNotice`, and `Subscription` and `PlanVersion` where a schema lacks
them. Under each model it names the other options that need it as well —
`TenantAccessHold` also wherever `adminResources` is on — and the option the
rule accepts in its place where there is one, such as
`tenantBilling.notices.record`. The `notAdopted` line it prints for the
persistence bundle no longer offers `SubscriptionNotice`; the check offers it
under the needed models, for where no option named for it is on.

`--serves-tenants` says `tenantBilling` is on: with it, one of those models
missing fails the check with exit 1. Without it, the check names them and exits
as it did. The check reads only the schema, so the switch does not cover an
application with only `adminResources` on, and it fails on a model whose records
the application keeps through the option the rule accepts in its place.

`@saasicat/core` exports `TENANT_SERVING_MEMBERS`: the persistence bundle
members a start with `tenantBilling` on is refused without, each with the rule
that refuses it, the options that rule answers to, the option it accepts in its
place where it accepts one, and the canonical models the shipped bundles keep
its records in.
