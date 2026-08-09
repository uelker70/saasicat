---
'@saasicat/nest': minor
'@saasicat/ui-vue': patch
'@saasicat/types': patch
---

Remove consumer domain vocabulary from the platform.

`slugify()` fell back to the literal `'verein'` when a tenant name reduced to
nothing, and that value reaches the tenant slug during registration — so a car
dealership or a notes app could end up on a slug from someone else's business.
The fallback is now `'tenant'`, the platform's own term. This changes observable
output for degenerate input (empty, whitespace-only, or a name with no ASCII
letters).

Two placeholder texts in the shared catalogs carried club vocabulary as their
example — the bundle description ("for active clubs") and the marketing feature
label ("Membership management"). Both are now domain-neutral; apps that want
their own wording set it via `i18n.overrides`.

Doc comments that illustrate how an app supplies its *own* vocabulary are kept
deliberately: they document the extension point rather than leak a domain into
the platform.
