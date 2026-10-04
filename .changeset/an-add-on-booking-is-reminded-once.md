---
'@saasicat/core': minor
'@saasicat/nest': minor
---

A booking is reminded once before its add-on version's retirement takes effect

14 days before a booking's date, the quarter-hour run reminds it once where
staying put costs it something (`SC-BUN-056`): the replacement takes a feature
away or lowers a quota, or is dearer for the plan the add-on runs beside at the
date, in the rhythm the booking is billed in then, or is not sold in it. Both
versions are priced from the catalogue as it stands for that plan, so a plan
changed since the notice decides the price.

- **Your port** is handed a new kind, `bundle-version-retirement-reminder`
  (`BundleVersionRetirementReminder`): the notice again, priced as the booking
  then compares, with `switchTerms`, what switching now costs, or null where
  the booking may not switch. A port that switches on `kind` adds it.
- **Not reminded:** a booking that switched, one that has declared a
  cancellation, one whose subscription ends by the date, and one whose notice
  reached nobody. A booking whose subscription ends later can still cancel or
  switch, and is reminded.
- **The add-on page** counts the bookings reminded beside each retired version.
- An application with a scheduler of its own calls
  `BundleRetirementReminderService.remindDue` beside the other steps.
