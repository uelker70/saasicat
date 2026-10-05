---
'@saasicat/ui-vue': minor
---

A promo code's days are read in the zone the application names

`createSuperAdminApp({ promoCodes: { timeZone } })` names the zone a promo
code's days are read in — the zone your server turns a picked day into an
instant in. The list, the edit dialog and the detail page read the days in it,
and a redemption's moment says its zone (`SC-PROMO-031`). Without it the days
are read in UTC, as the edit dialog did already; the list, which read the
browser's zone, reads UTC too. A code saved with something else changed sends
neither day back, whatever zone the browser is in. A zone the browser cannot
read stops `createSuperAdminApp` at start.
