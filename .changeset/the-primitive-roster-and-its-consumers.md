---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

**Twelve admin primitives, and every hand-built copy of them is gone.**

New in `@saasicat/ui-vue/ui/*.vue`:

- `AdminBanner` — an inline notice, in one of four tones
- `AdminErrorBanner` — the failure case of that. One prop, and it renders
  nothing when there is no error, so a page binds it unconditionally
- `AdminEmptyState` — what a list shows when it has nothing to show
- `AdminDialog` — the chrome under every dialog
- `AdminFormDialog` — a dialog whose point is a write. Owns the submit
  lifecycle: disabled while pending, failure shown without closing
- `AdminConfirmDialog` — a dialog that asks before something irreversible
- `AdminToolbar` — the action row above a table that is not the hero
- `AdminRowActions` — the per-row controls in a table's `row-actions` slot
- `AdminField` / `AdminFieldGrid` — a labelled control, and the grid it sits in
- `AdminStatusPill` — a status, as a word plus a tone

`AdminStatusPill` is promoted out of a private directory where one page used
it while nine other places rendered their own status display. Its `PillTone`
type is exported from `@saasicat/ui-vue/vue`, along with `PROMO_STATUS_TONE` —
the one status vocabulary shared across pages.

**What this replaces.** Nineteen hand-written banners in six different colour
recipes, nineteen raw `<q-dialog>` sites in seventeen files, five word-for-word
copies of the same `errMsg()` helper, and the four pages that reached for
`useQuasar()` because the confirm port had no consumer. All four numbers are now
zero. Two dialogs keep their own submit handler on purpose: they route a failure
to the MFA prompt or to themselves depending on the response reason, and a
component that owns the error cannot make that split.

**One behaviour fix rides along.** A fully redeemed promo code rendered red —
both copies of the page's status-to-colour function fell through to `negative`
for `EXHAUSTED`. The campaign that worked best looked like a defect. It is now
muted.

**Breaking: the default UI locale is English.** `DEFAULT_SA_LOCALE` was `'de'`
and is now `'en'`. It is also the fallback for `Intl`, so an app that names no
locale now formats dates and currency the English way as well. German remains a
complete, first-class catalog — an app that wants it passes
`createSuperAdminApp({ i18n: { locale: 'de' } })`, and a missing English
translation is still a compile error.

**Also fixed:** dialogs teleport out of the page, so the package's page-wide
`box-sizing: border-box` never reached them. Hand-built modals each carried
their own reset; the shared dialog chrome now carries it once.

---

**Two standard pages read their data themselves.** `PromoCodesPage` and
`AuditPage` no longer take loader or submit props — they ask the platform's
resource registry by name. `PromoCodesPage` drops `loadPromos`, `submitCreate`,
`submitEdit` and `submitDelete`; `AuditPage` drops `loadAudit`. An app that
rendered either with the standard wiring can delete that wiring; an app that
needs one call diverted passes `:resources` instead of re-supplying all of them.

**`useResource(key, override?)`** takes a per-page override now, layered over the
app-wide one rather than replacing it — platform, then app, then instance. An app
that wraps an operation app-wide keeps that wrapper when a single page is pointed
somewhere else.

**Fixed: the audit resource sent parameters the endpoint ignores.**
`auditResource.list` spoke `AuditQuery` (`actorTag`, `from`, `to`, paginated) at
`GET /admin/audit`, which accepts `actor`, `action`, `entity`, `since`, `limit`
and answers with a bare array. `AuditQuery` belongs to `AuditQueryPort`, one
layer below HTTP — the adapter translates. Filtering the audit list by actor
would have returned an unfiltered list that looked filtered. Nothing consumed the
descriptor yet, so no released version shipped the wrong request; it is corrected
before the page reaches it.

Two consequences for anyone who did use it: `AuditListFilter` is now
`AdminAuditListFilter`, and `useResourceList('audit')` no longer compiles —
the operation returns an array, not a page, so `audit` is not a list resource.
Call `useResource('audit').list(filter)`.

**`PromoRow` lost its `[extra: string]: unknown`.** It was there so rows arriving
through a `loadPromos` prop could carry anything an app returned. The resource
decides the shape now, and the index signature was what kept a typo from being
distinguishable from a field the server had started sending.
