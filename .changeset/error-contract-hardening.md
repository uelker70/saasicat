---
'@saasicat/types': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': patch
---

Make the error contract hold what it promises

Breaking. A review of the error-code release found the contract stated more
than the wire delivered.

**`message` is now always present.** `PlatformErrorBody` declared it required,
but 36 throw sites passed only `{ code }` — most of the registration funnel,
every OTP failure. NestJS hands an object argument through verbatim, so those
responses shipped without a message: a consumer typing the body read
`undefined`, and `body.message.includes(...)` threw. A new `codedError(code,
params?)` derives the message from the shipped English catalogue, which also
makes the fallback text identical to the shipped default by construction.

**One params shape per code.** The same code carried different keys depending
on which service threw it — `versionId` here, `bundleVersionId` there. Since a
consumer's translation interpolates by key name, half the throw sites left the
placeholder unfilled. `error-params-contract.test.js` now fails if a throw site
omits a placeholder its template names, or if two sites disagree on a key.

**`FEATURE_NOT_LICENSED` has one shape.** Both feature guards always emit the
full `FeatureNotLicensedBody`; without a resolver `offers` is `[]` rather than
absent, so a consumer can rely on the declared type. The code is now part of
`PLATFORM_ERROR_CODES`, so an exhaustive switch covers it.

**Renamed / split codes** — update any consumer that matches these strings:

| before                                 | after                                                    |
| -------------------------------------- | -------------------------------------------------------- |
| `PLAN_VERSION_NOT_LIVE`                | `PLAN_VERSION_NOT_PUBLISHED` / `PLAN_VERSION_SUPERSEDED` |
| `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED`                  |
| `SUBSCRIPTION_BUNDLE_NOT_CANCELED`     | `SUBSCRIPTION_BUNDLE_NOT_CANCELLED`                      |

The split matters: one code covered both "was never published" and "already
superseded", which a consumer could not tell apart.

Also: `QUOTA_DIMENSION_UNKNOWN` is emitted instead of a bare `Error` (still
500 — the dimension comes from the calling code, not from user input), the
promo rate limiter sends the `retryAfterSeconds` its catalogue entry promises,
and `requireSubscriptionPk` gained `SUBSCRIPTION_PK_MISSING` so a wiring error
is distinguishable from a missing subscription.

`reason` remains alongside `code` everywhere it existed.
