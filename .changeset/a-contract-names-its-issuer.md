---
'@saasicat/core': minor
'@saasicat/spec': patch
'@saasicat/nest': minor
---

A contract is not concluded without an issuer

An application that concludes contracts — `tenantBilling.contractFreeze`, a
checkout offer's `conclusion` or `SubscriptionContractModule` — no longer
starts while `config/saas.yaml` names no `issuer`, so no contract is concluded
with nobody on the operator's side (`SC-AUD-020`, superseding `SC-AUD-012`).
`SubscriptionContractService` refuses the start, and `SubscriberService` gains
`issuerNamed()`, which refuses a contract written by a service built outside
those modules. An application that concludes none may still leave the block
out.

A contract concluded while the file named no issuer, and one whose parties the
subscriber migration copied, stays held by the invoice run with
`SUBSCRIPTION_INVOICE_PARTIES_UNCONFIRMED`: nothing says who its parties were
the day it was concluded, and no step confirms them later. Every successor
frozen afresh — such as after a change of plan or of its billing rhythm, an
add-on booked or ended, a move to another version, or a refresh in full —
copies both parties as they stand that day and is invoiced; a refresh of the
features and a withdrawn feature keep the copy.
The code's message now says that rather than asking for a confirmation.

`contractPartiesOf` in `@saasicat/core` takes the issuer as required and always
copies one.
