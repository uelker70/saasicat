---
'@saasicat/ui-vue': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
---

Fix four defects that only showed up in a running admin

**A route-mounted page cannot require props.** `AdminManifestErrorPage`
declared `onRetry` and `onLogout` as required, but `createAdminRoutes()`
mounts it as a plain route record and Vue Router passes nothing to such a
component. The props were unsatisfiable by construction, and this is the
fail-closed screen — it renders precisely when the app is already in
trouble, and both of its buttons called `undefined`. They are now optional
with defaults that work standalone.

**An expired session is not a broken manifest.** A 401/403 from the
manifest load sent the operator to the error page — "the manifest could not
be loaded" — when the truth was "log in again". This is the normal path
after a token expires, because `isAuthenticated()` in practice only checks
that a token exists. The guard now separates the two, and offers the
re-login exactly once: a consumer's `onUnauthenticated` typically clears the
session, so a manifest that keeps rejecting for a reason logging in cannot
fix would otherwise produce an unbreakable login loop.

**Requests bypassing the HttpClient seam.** Three call sites used a bare
`fetch()`, dropping the Authorization header the app registered via
`createSuperAdminApp({ http })`. One of them was unreachable code that
looked like a safeguard; two were live.

**`@RequireFeature` failing silently.** `SaaSiCatModule` documented a boot
warning for the case where no plan resolver is configured — and never
emitted one. Annotated routes then served everyone, quotas read as
unlimited, and nothing said so. Two warnings now, each naming what is inert
and how to fix it.

Also: the primary `saasicat` CLI now speaks English (it was entirely German,
against the README's own promise), and `@saasicat/ui-vue` emits the
declaration files its `./testing-e2e/*` export has always promised — a
concurrent `clean` in the build deleted them after writing.
