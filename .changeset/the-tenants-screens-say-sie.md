---
'@saasicat/core': patch
'@saasicat/ui-vue-tenant': patch
---

The German texts of the tenant's screens address the reader as "Sie"
throughout

Eight sentences of the tenant catalogue — the plan change's first step, the
add-ons' lead and empty state, the payment method's provider note and the
billing details' notes — and thirty-five German refusals of
`ERROR_MESSAGES_DE` said "du", in a pronoun or in the imperative alone, beside
the rest, which said "Sie". They now say "Sie" too. Codes,
placeholders and the English texts are unchanged; an application that
overrides one of these keys keeps its own sentence.
