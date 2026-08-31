---
'@saasicat/core': minor
'@saasicat/nest': major
'@saasicat/ui-vue': patch
---

<!-- language-history: this note names the German identifiers it removes, because a
     rename nobody can follow is not a migration instruction. -->

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

**A catalogue offers at most one recommended plan.** `highlight` is a boolean
on a projection, and a projection belongs to one plan version and one language,
so no single row could keep that promise: two rows in the same language carry
it, or one carried in the default language reaches another language through the
fallback that fills in a missing translation — and each row is correct on its
own. The public catalogue decides it, because only there are the live versions,
the requested language and the fallback known at once. A row written for the
language that was asked for wins; failing that, the first plan the catalogue
offers. The others keep their card and lose the mark. `SC-MKT-009` is
superseded by `SC-MKT-022`, which says which one wins. The SuperAdmin's
mock-up of that page applies the same rule from `@saasicat/core`, so it stops
showing two cards the website will never show both of.

Two consequences worth naming. The editor no longer refuses a second
recommended projection — a check there sees neither which version is live nor
the fallback, so it refused on rows the editor does not display and still let
two cards through. And add-on projections, which that check happened to cover,
are constrained by nothing again; no requirement ever covered them, and nothing
in the repository reads the flag for an add-on.

**German out of what ships**, and a guard so it stays out. `SC-LANG-011`
promised English — code, comments, documentation, developer-facing errors,
release notes and the command-line tools — and nothing measured it, so it
drifted where nothing is reread: the type definitions `@saasicat/spec` hands
CommonJS consumers, a CLI conventions document whose worked example ran a
German command, a worked example in the backend guide whose every label was
German, the schema comments a consumer copies, comments quoting German captions
across the admin screens, and four German names in a shipped public API on
`TenantDetailPage` (the `stammdaten` slots and props are now `master-data`).

**Six refusal codes a consumer could not resolve.** `ERROR_MESSAGES_EN` is
`Record<PlatformErrorCode, string>`, so the compiler holds the catalogue and
the code set together — for codes that are in `PLATFORM_ERROR_CODES`.
`REDUNDANT_FEATURES`, `MINIMUM_TERM_BINDS`, `SUBSCRIPTION_CHANGED`,
`NO_SUBSCRIPTION`, `CANCELLATION_TERMS_CHANGED` and
`BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED` were thrown or pushed as bare string
literals and were in neither, so a tenant met a refusal their app had no text
for. All six are declared now, in English and German. Seven bundle-preview
templates also named values the preview never passed — a translating consumer
rendered `{bundleVersionId}` at the reader — and `SubscriptionBundlePreviewIssue`
gained the `params` field its plan-change sibling already had.

The guard that would have caught them read one preview service; it reads both,
and refuses a service that contributes nothing to the scan, so a rename cannot
quietly take one out while the other holds the count up.

What the guard measures is named in its own header rather than implied: it
reads the file types that carry prose and holds them against a list of German
words that cannot be English. A file that is a translation catalogue says so in
its first lines. It is a floor and not a sweep — the word list is finite, and
`.yaml`, `.json` and the example's shell and Docker files are outside its reach
today.
