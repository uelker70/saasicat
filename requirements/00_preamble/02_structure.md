## How an entry is built

Every requirement carries an identifier of the form `SC-<CHAPTER>-<NNN>`, numbered from `001`
within its chapter. Under the heading stands the promise, and under that the `_Source:_` line
naming where the decision came from — an issue number, an architecture decision record, a document
in this repository, or the release the behaviour arrived in. Where the promise is complete in its
heading, there is nothing between the two, and where its reason is not obvious that reason is the
most valuable part of the entry.

## What state an entry is in

An entry says one of four things, and which one it says decides what a reader may do with it. The
question behind the table is always the same: **may somebody rely on this?**

| State                         | Opens with                                     | May somebody rely on it?                |
| ----------------------------- | ---------------------------------------------- | --------------------------------------- |
| 🟢 Current                    | `🟢`                                           | Yes                                     |
| 🟡 Decided, not yet delivered | `🟡 _(Decided, not yet delivered.)_`           | It is settled, and it is not true yet   |
| ⚪ Draft                      | `⚪ _(Draft since YYYY-MM-DD.)_`               | No — not decided, and it may not happen |
| 🔵 Superseded                 | ``🔵 _(Superseded on YYYY-MM-DD by `SC-…`.)_`` | No — follow the successor it names      |
| 🔴 Withdrawn                  | `🔴 _(Withdrawn on YYYY-MM-DD.)_`              | No, and nothing replaces it             |

**Every entry opens with exactly one of these**, the ordinary case included. Marking only the
exceptions would be quieter, and it would mean the ordinary state is read out of a blank — and a
state read out of a blank is a state nobody checked. That is not theory: a marker wrapped across a
line break went a day unnoticed here, and two requirements counted as promises the product keeps
while nothing anywhere said otherwise.

The colour is not the state — the words are, where there are words — and the checker holds the two
together, because a colour is read faster than a sentence and a wrong one misleads whoever trusts
it. Current carries no words because it qualifies nothing: no date, no successor.

Superseded and withdrawn look alike to whoever writes them and not at all alike to whoever reads
them: one hands a reader arriving from an old reference somewhere to go, the other tells them there
is nowhere. That is why they are two states and not one.

A state carries a date because the risk each one runs is time. A draft opened a year ago and never
decided reads exactly like one opened last week, and only one of the two is still somebody's
intention.

Behind the state, an entry may say what a breach of it would cost:

| Mark | What it costs                                        |
| ---- | ---------------------------------------------------- |
| 💰   | Money or law — wrong amounts, wrong dates, wrong tax |
| 🔒   | Tenant separation, access, or somebody's data        |

Most entries carry neither, which is the ordinary case and stays quiet. Three values rather than
five, because a scale nobody can apply is a scale everybody applies differently — and an entry
without a mark is not unassessed, it is ordinary.

Beside its state, an entry that stands may say it is not true yet:

- `🟡 _(Decided, not yet delivered.)_` — the decision is settled and recorded, the implementation is
  not there yet. Only a current entry may say this: a draft is not decided, and a retired one has
  nothing left to deliver. Such entries are listed under the chapter table, because a decision
  nobody can find is a decision that gets taken twice — and because what a product has promised and
  not yet built is a question asked before somebody buys, not while they scroll.

**Identifiers are permanent and a number is never reused.** Somebody outside this repository may
have written one down, and it must never come to mean something other than it did. So a promise is
not edited into a different promise: the entry stays where it is, opens with what became of it, and
the new wording becomes a new entry with the next free number in its chapter.

A correction that leaves the promise intact — a typo, a clearer sentence, a reference following
somebody else's supersession — is made in the entry itself. What decides between the two is whether
what somebody can rely on changes.

Chapters 1 to 16 are functional: what the product does. Chapters 17 to 24 are non-functional: the
properties it has while doing it.

## Chapters and identifiers

<!-- BEGIN chapters — generated, do not edit: node scripts/requirements/index.mjs --write -->

| #   | Chapter                                      | Identifiers  | Entries |
| --- | -------------------------------------------- | ------------ | ------- |
| 1   | The product and its boundary                 | `SC-SCOPE-…` | 13      |
| 2   | Capabilities, features and quotas            | `SC-CAT-…`   | 16      |
| 3   | Plans and their versions                     | `SC-PLAN-…`  | 25      |
| 4   | Add-on bundles                               | `SC-BUN-…`   | 33      |
| 5   | Subscriptions, terms and billing periods     | `SC-SUB-…`   | 17      |
| 6   | Changing a plan                              | `SC-CHG-…`   | 19      |
| 7   | Cancelling                                   | `SC-CANC-…`  | 22      |
| 8   | Trials, pilots and negotiated arrangements   | `SC-SPEC-…`  | 9       |
| 9   | Prices, proration, tax and money             | `SC-PRIC-…`  | 49      |
| 10  | What a tenant may do at runtime              | `SC-ENTL-…`  | 21      |
| 11  | Promotional codes                            | `SC-PROMO-…` | 22      |
| 12  | Self-registration                            | `SC-REG-…`   | 22      |
| 13  | The public catalogue, checkout and contracts | `SC-MKT-…`   | 24      |
| 14  | Administration and access to it              | `SC-ADM-…`   | 27      |
| 15  | Working in the interface                     | `SC-UI-…`    | 24      |
| 16  | Configuring and running an installation      | `SC-CFG-…`   | 35      |
| 17  | Accessibility                                | `SC-A11Y-…`  | 12      |
| 18  | Language and wording                         | `SC-LANG-…`  | 13      |
| 19  | Security and keeping tenants apart           | `SC-SEC-…`   | 13      |
| 20  | What is kept, and what is never written down | `SC-PRIV-…`  | 18      |
| 21  | Answering the question afterwards            | `SC-AUD-…`   | 16      |
| 22  | Repeating an operation safely                | `SC-OPS-…`   | 11      |
| 23  | Compatibility and upgrading                  | `SC-COMP-…`  | 15      |
| 24  | Being understandable to a stranger           | `SC-READ-…`  | 8       |

Of 484 entries: 🟢 413 stand today, 🟡 68 decided but not yet delivered, ⚪ 0 drafts,
🔵 2 superseded, 🔴 1 withdrawn.

🟡 **Decided, not yet delivered** — [SC-SCOPE-011](#sc-scope-011--saasicat-invoices-subscriptions-and-collects-payment-through-a-payment-gateway),
[SC-SCOPE-012](#sc-scope-012--a-tenant-holds-the-applications-data-the-subscriber-is-the-party-to-the-contract),
[SC-SCOPE-013](#sc-scope-013--subscriber-and-invoice-models-avoid-the-applications-own-names-and-a-clash-is-reported),
[SC-PLAN-007](#sc-plan-007--publishing-says-what-changed),
[SC-SUB-017](#sc-sub-017--a-subscribers-legal-identity-can-be-corrected-not-replaced-under-a-running-contract),
[SC-CANC-020](#sc-canc-020--an-ended-subscription-leaves-the-tenant-a-period-to-read-and-export-before-its-deletion),
[SC-CANC-021](#sc-canc-021--the-read-only-period-and-the-deletion-date-are-stated-before-a-tenant-cancels),
[SC-CANC-022](#sc-canc-022--a-tenant-is-reminded-before-its-data-is-deleted),
[SC-PRIC-018](#sc-pric-018--rounding-happens-once-when-a-charge-is-written),
[SC-PRIC-019](#sc-pric-019--a-tenant-can-see-their-own-account),
[SC-PRIC-020](#sc-pric-020--a-charge-once-written-is-never-edited),
[SC-PRIC-021](#sc-pric-021--an-internal-account-reference-is-never-shown-to-a-customer-as-an-invoice-number),
[SC-PRIC-022](#sc-pric-022--every-charge-of-a-subscription-is-invoiced-once-on-that-subscriptions-invoice),
[SC-PRIC-023](#sc-pric-023--invoice-numbers-have-no-gaps-within-an-installation-and-a-prefix-sets-it-apart),
[SC-PRIC-024](#sc-pric-024--an-installations-invoice-number-prefix-cannot-change-once-an-invoice-exists),
[SC-PRIC-025](#sc-pric-025--an-issued-invoice-is-never-edited-a-cancellation-invoice-corrects-it),
[SC-PRIC-026](#sc-pric-026--an-invoice-carries-the-issuer-and-the-subscriber-as-they-were-on-the-day-it-was-issued),
[SC-PRIC-027](#sc-pric-027--an-invoice-carries-what-the-tax-law-of-its-issuer-requires-of-it),
[SC-PRIC-028](#sc-pric-028--a-direct-debit-is-announced-before-it-is-collected),
[SC-PRIC-029](#sc-pric-029--a-payment-is-recorded-against-its-invoice-once-the-gateway-has-confirmed-it),
[SC-PRIC-030](#sc-pric-030--a-payment-method-is-entered-in-the-gateways-own-form-and-saasicat-keeps-a-reference),
[SC-PRIC-031](#sc-pric-031--a-returned-debit-or-a-chargeback-is-recorded-and-what-the-payment-settled-opens-again),
[SC-PRIC-032](#sc-pric-032--no-contract-is-frozen-and-no-invoice-issued-before-the-subscribers-identity-is-complete),
[SC-PRIC-033](#sc-pric-033--an-invoice-interrupted-in-archiving-keeps-its-number-and-is-never-issued-twice),
[SC-PRIC-034](#sc-pric-034--a-collection-retried-after-an-unanswered-request-never-charges-twice),
[SC-PRIC-035](#sc-pric-035--an-invoice-left-unpaid-past-its-grace-period-makes-the-tenant-read-only),
[SC-PRIC-036](#sc-pric-036--what-an-invoice-owes-and-how-it-is-paid-changes-one-step-at-a-time),
[SC-PRIC-037](#sc-pric-037--the-tax-a-subscriber-is-charged-is-decided-by-a-tax-adapter-for-the-issuer),
[SC-PRIC-038](#sc-pric-038--a-contract-and-an-invoice-record-the-tax-treatment-and-the-adapter-that-decided-it),
[SC-PRIC-039](#sc-pric-039--a-subscriber-the-tax-adapter-cannot-treat-is-refused-before-a-contract-exists),
[SC-PRIC-040](#sc-pric-040--a-tax-identifier-is-validated-before-a-tax-treatment-depends-on-it),
[SC-PRIC-041](#sc-pric-041--an-invoice-computes-its-tax-once-per-rate-by-the-rule-its-tax-adapter-names),
[SC-PRIC-042](#sc-pric-042--an-invoice-is-issued-in-the-format-its-tax-adapter-requires),
[SC-PRIC-043](#sc-pric-043--a-change-to-a-subscribers-tax-origin-applies-from-its-next-invoice),
[SC-PRIC-044](#sc-pric-044--the-german-tax-adapter-covers-germany-businesses-abroad-and-small-businesses),
[SC-PRIC-045](#sc-pric-045--invoice-dates-and-tax-periods-count-in-the-installations-time-zone),
[SC-PRIC-046](#sc-pric-046--an-invoice-states-the-day-it-is-due),
[SC-PRIC-047](#sc-pric-047--every-invoice-reaches-the-subscriber-by-email-with-its-file-attached),
[SC-PRIC-048](#sc-pric-048--a-billing-period-whose-charges-are-all-zero-issues-no-invoice),
[SC-PRIC-049](#sc-pric-049--a-subscribers-account-is-shown-to-the-tenants-users-holding-the-billing-permission),
[SC-REG-021](#sc-reg-021--a-payment-confirmation-is-verified-before-anything-is-created-from-it),
[SC-ADM-019](#sc-adm-019--early-deletion-cancelling-an-invoice-and-joining-a-subscriber-need-a-second-factor),
[SC-ADM-020](#sc-adm-020--six-actions-require-a-written-reason-cancelling-an-invoice-among-them),
[SC-ADM-021](#sc-adm-021--an-operator-finds-everything-about-a-subscriber-in-one-record),
[SC-ADM-022](#sc-adm-022--an-operator-lists-every-invoice-with-totals-per-period-and-tax-rate-and-exports-it),
[SC-ADM-023](#sc-adm-023--an-operator-can-list-open-items-and-every-contract-including-former-subscribers),
[SC-ADM-024](#sc-adm-024--a-suspended-tenants-users-cannot-act-and-a-read-only-tenant-cannot-write),
[SC-ADM-025](#sc-adm-025--an-operator-gets-a-description-of-the-invoicing-procedure-to-document-its-own-on),
[SC-ADM-026](#sc-adm-026--the-administrator-changes-what-the-tenant-pays-billing-needs-the-billing-permission),
[SC-ADM-027](#sc-adm-027--an-operator-joins-a-returning-customers-new-tenant-to-the-subscriber-it-had),
[SC-UI-022](#sc-ui-022--a-tenant-downloads-its-subscriptions-invoices-and-tells-them-from-the-applications),
[SC-UI-023](#sc-ui-023--a-tenants-invoices-payment-method-and-billing-details-need-the-billing-permission),
[SC-UI-024](#sc-ui-024--a-tenants-invoice-list-says-what-each-invoice-stands-for),
[SC-PRIV-011](#sc-priv-011--contracts-invoices-and-payments-outlive-the-tenant-they-were-for),
[SC-PRIV-012](#sc-priv-012--a-record-kept-for-tax-purposes-is-not-deleted-automatically),
[SC-PRIV-013](#sc-priv-013--a-subscriber-with-no-live-tenant-and-no-claim-left-keeps-only-what-its-documents-need),
[SC-PRIV-014](#sc-priv-014--a-tenant-is-deleted-through-the-application-which-first-names-what-to-keep),
[SC-PRIV-015](#sc-priv-015--a-tenants-deletion-leaves-a-record-with-the-subscriber-that-names-no-person),
[SC-PRIV-016](#sc-priv-016--erasing-a-tenants-data-or-files-is-refused-unless-exactly-one-tenant-is-named),
[SC-PRIV-017](#sc-priv-017--a-tenant-is-deleted-only-after-its-full-export-was-offered-in-the-read-only-period),
[SC-PRIV-018](#sc-priv-018--a-tenants-deletion-can-safely-run-again-and-is-done-only-once-every-store-confirms),
[SC-AUD-010](#sc-aud-010--a-charge-names-where-it-came-from-and-which-agreement-line-it-belongs-to),
[SC-AUD-011](#sc-aud-011--a-charge-carries-the-period-it-belongs-to),
[SC-AUD-012](#sc-aud-012--a-contract-carries-both-parties-as-they-were-when-it-was-concluded),
[SC-AUD-013](#sc-aud-013--every-invoice-line-can-be-traced-to-the-charge-and-the-contract-line-it-came-from),
[SC-AUD-014](#sc-aud-014--an-invoice-downloaded-later-is-the-document-that-was-issued-not-a-new-rendering),
[SC-AUD-015](#sc-aud-015--an-archived-invoice-is-checked-against-the-checksum-recorded-when-it-was-rendered),
[SC-AUD-016](#sc-aud-016--concluding-or-changing-a-contract-gives-the-subscriber-a-confirmation-to-keep)

🔵 **Superseded** — [SC-ENTL-004](#sc-entl-004--once-a-contract-is-agreed-it-is-the-truth-about-what-the-tenant-may-do),
[SC-MKT-009](#sc-mkt-009--at-most-one-plan-is-marked-as-the-recommended-one)

🔴 **Withdrawn** — [SC-REG-016](#sc-reg-016--the-account-the-tenant-and-the-subscription-are-created-together-or-not-at-all)

<!-- END chapters -->
