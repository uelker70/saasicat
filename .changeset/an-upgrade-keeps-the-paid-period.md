---
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

An immediate upgrade runs inside the period already paid, or starts a longer
one today less the unused rest

An immediate upgrade opened a new period from the day of the change, which
moved the day the customer is billed on, while the preview charged the
difference over the old period — two answers for one change. For a move into a
longer rhythm the preview took the difference between a year's price and a
month's over what was left of the month: Standard at 49 a month to Pro at 990 a
year on day 15 of 30 was quoted at 470.50.

- In the same rhythm the period and the billing day stay, and the difference is
  charged for what is left of it (`SC-CHG-020`, superseding `SC-CHG-003`).
- Into a longer rhythm the new period starts today, charged in full less the
  unused rest of the old one at the price paid for it: 990 − 24.50 = 965.50
  in the example (`SC-CHG-021`). The rest is never paid out.
- `ProrationDto` gains `basis` (`difference` or `newPeriod`) and `remainderNet`;
  `computeNewPeriodCharge` is new beside `computeProration`. The plan change
  wizard shows the full price and the rest it is reduced by, with three new
  catalogue keys (`wizardNewPeriodLine`, `wizardRemainderLine`,
  `wizardConfirmDueNow`).
