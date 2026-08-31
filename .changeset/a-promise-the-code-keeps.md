---
'@saasicat/core': major
'@saasicat/nest': major
---

Keep three promises the catalogue made and the code did not

**A feature marked as not yet rolled out is no longer granted through a
contract.** `SC-ENTL-003` says "never … wherever it comes from", and the filter
sat in the aggregator, which a frozen contract does not go through: limits read
from `entitlementSnapshot` or from contract line items were handed over as they
stood. A successor pulled in by a `replaces` alias could arrive the same way.
Both paths now end in one place, so no path can skip it.

`SC-ENTL-004` said catalogue edits do not reach a running contract, which this
makes false in one case, so it is superseded by `SC-ENTL-021`: a commercial
edit — a price, a quota, a feature set — still leaves an agreed contract alone;
a feature losing its code does not, because that is a statement about whether
the capability exists rather than about what was sold.

**At most one plan is the recommended one, and now something enforces it.**
`highlight` was a free boolean per marketing projection, so a pricing page
could show two recommended plans. Setting a second one for the same kind and
language is refused with `MARKETING_HIGHLIGHT_TAKEN`, which names the
projection holding it. Refused rather than moved: clearing somebody else's
highlight is a change they did not ask for, on a row they are not looking at.
Plans and add-ons are independent, and so is each language.

**German out of what ships.** Two comments in `PlansPage.vue`, a sentence in
the type definitions `@saasicat/spec` ships to CommonJS consumers, a CLI
conventions document whose worked example ran `myapp paket apply`, a scenario
template in the acceptance README, and a subtitle in the NotesApp example.
`SC-LANG-011` promised English and nothing measured it.
