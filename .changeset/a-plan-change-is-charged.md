---
'@saasicat/nest': minor
---

A subscriber's account charges an immediate plan change

The account now records what an immediate upgrade's preview quoted
(`SC-PRIC-059`). In the same rhythm that is the difference for the rest of the
period, beside the period's own charge. Into a longer rhythm it is the new
period in full, less the unused rest of the one it replaces at the price in
force just before the change, never below nothing. The renewals then run on
from the new period. Both are `planChange` charges, derived from the contract
and the window the change leaves behind.

A discount is charged on whole periods of the rhythm it was agreed in. The
difference an upgrade adds carries none. When the rhythm changes, what is left
of the discount is taken off the new period, and no more than that period
costs (`SC-PRIC-060`).
