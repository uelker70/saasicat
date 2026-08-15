---
'@saasicat/ui-vue': minor
---

Define an admin endpoint once — starting with the plan catalogue

A resource is a named set of operations over `(http, ctx, ...args)`:
framework-free, so `node --test` can drive it against `dist/` like the rest of
the client layer. `defineResource` declares one, `bindResource` supplies
`(http, ctx)` and hands back the callable operations.

It exists because the same URL is currently assembled in several places.
`catalog/plans/:planId/versions` is built by `usePlanVersions` and again by
`useLivePlanVersions`; the JSON request/response dance around it — a `204`
means empty, a 2xx body may not parse, `>= 400` throws with the parsed body
attached — is written out **four** times in this package, twice byte-identically
inside one file. That is one decision, so it is written once.

Landing with it: `plansResource` and `planVersionsResource`, twelve operations.
The two path stems are the server's asymmetry, not a tidiness problem — reading
and creating versions goes through the plan, every mutation of an existing
version addresses the version directly — and they are preserved rather than
normalised.

**Partial on purpose.** The roster covers the whole admin surface eventually,
and the descriptors land family by family as the composables that own those
endpoints are rebuilt on them. A descriptor nothing calls has nothing keeping it
honest.

The behaviour is deliberately identical, including two things that look like
defects and are not fixed here: path parameters are interpolated without
encoding, and a project key is appended to some operations and not others. Both
are what the composables do today. Changing either would send a different
request than the one that goes out now, which is a behaviour change and belongs
in a change that says so.

---

Found while writing it, and worth more than the descriptors: **`usePlans` and
`usePlanVersions` had no test at all**, and they own twelve endpoints. Two
suites now cover them.

One drives the composable and the descriptor with the same arguments and
compares what each puts on the wire, rather than asserting a hand-written list
of URLs twice. It failed on the first run: `terminateVersion(versionId, endsAt)`
takes the date as a string and wraps it as `{ endsAt }`, while the descriptor
had been written to pass its argument through. A hand-written assertion would
have enshrined the mistake instead of catching it.

The other pins what each operation does with the answer — create appends,
update replaces in place, a rejected delete leaves the row where it was, and
`loadTenantCounts` swallows its failure on purpose without touching the page's
error state. That half is what a rebuild could quietly change, and it is now
held.

Line coverage 79.53 → 82.68, functions 80.47 → 82.86. Branch measured 0.29pp
lower; the baseline keeps its previous, stricter value rather than recording
the looser one.
