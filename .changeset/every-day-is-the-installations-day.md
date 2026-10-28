---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
---

Every day the administration shows is a day of the installation

The manifest names the installation's `timeZone` as `config/saas.yaml` sets
it, and the administration shows every moment as the day it falls on there —
a collection attempt, a credit, a contract concluded, a tenant created, a
login — instead of the UTC day its ISO text begins with or the browser's day.
A period, a trial or a minimum term is shown with the last day it covers, so
one that ends at midnight before 1 December ends with 30 November. A day
picked in a date field and stored as its UTC midnight is that day in every
zone, and today in a form is the installation's today. Where the file names
no zone, the days are UTC days. A moment with its time of day stays the
reader's, with the zone named.

`formatDay` now writes a calendar day (`YYYY-MM-DD`) only; called with an ISO
moment it answers `Invalid Date` instead of that moment's UTC day. Say which
day is meant with `formatMomentDay`, `formatLastDayBefore`, `formatStoredDay`
or `useInstallationDays()`, all new in `@saasicat/ui-vue` beside
`formatShortDay`, `dayOfMoment`, `lastDayBefore`, `storedDayOf` and `todayIn`.
`AdminManifest` gains the optional `timeZone`. `promoCodes.timeZone` stays: it
names the zone a promo day is stored in. An application's pilot routes hand
`pilotEndsAt` back as the picked day's UTC midnight, which is what
`new Date(endsAt)` makes of it; the pilots list shows the day it begins with
rather than the browser's day.
