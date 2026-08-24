---
'@saasicat/nest': patch
---

The rules that decide whether a version may be published are written once now,
not once per entity.

Plans and bundles asked the same five questions of a publish — is there a start,
is it a date, is it after the predecessor's, does it meet a predecessor that
ends, is the end after the start — in sixty-five lines each, differing only in
which error code they named. Nothing changes for a caller: the codes, the
messages and the extra fields on the gapless refusal are the same on both
routes. What changes is that a correction now lands in one place; the second
copy carried a comment saying "analogous to Plan" instead of the reasoning, and
that is what a divergence looks like before it happens.

The bundle DTOs lost the same kind of repetition. Their constraints are composed
from named decorators (`IsBoundedText`, `IsDecimalAmountOrNull`,
`IsIsoDateOrNull`, `IsFeatureKeyList`, `IsSortOrder`) and the two version-draft
DTOs share a base class for everything except the feature list, which is what
actually separates them. One drift is fixed on the way: the update route's price
and feature errors carried no message, so the same bad payload came back
explained on create and unexplained on update. Both explain now.
