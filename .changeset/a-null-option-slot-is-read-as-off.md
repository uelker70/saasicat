---
'@saasicat/nest': patch
---

A module option slot set to `null` is read as one without settings

`SaaSiCatModule.forRoot` reads a feature slot such as `entitlement`,
`tenantBilling` or `adminResources` as absent, `false`, `true` or an object.
A `null` there — which the types leave out but a configuration read from JSON
or the environment can hold — could fail the start with a `TypeError`, as
`entitlement: null` beside tenant billing did; it is now read as a slot without
settings, as every check of whether a slot is on already read it.
