---
title: Language and wording
---

Two audiences read SaaSiCat's text, and they are owed different things. A tenant reads it in the
language they chose. An integrating developer reads diagnostics, and those stay in one language on
purpose. This chapter also fixes what a refusal is: a code that does not change, and a wording
that may.

### SC-LANG-001 — A person reads the interface in the language they chose

🟢 They can change it from the shell, on the sign-in card and during first-run set-up, and the choice
is remembered and outranks whatever the installation configured.

_Source:_ #45 · #47 · release 0.16.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/locale-switcher.test.ts`
    - LocaleSwitcher visibility
        - renders when the app offers several languages
        - renders nothing when the app opted out
        - a context from an older package version still shows it
    - LocaleSwitcher contents
        - the button shows the active language by its own name
        - an app-supplied language is labelled from availableLocales
        - an unknown active locale falls back to its code instead of blanking
        - the accessible label comes from the catalog
        - every offered language becomes a menu entry
    - LocaleSwitcher selection
        - picking an entry writes the shared locale
        - only the active entry carries the check mark
- `packages/ui-vue/tests/i18n.test.js`
    - i18n locales
        - German is the default locale
        - every locale has a catalog, an Intl tag and a switcher label
        - isSaBuiltinLocale accepts shipped locales and rejects anything else
    - createSuperAdminI18n
        - defaults to the platform locale
        - switching the locale swaps the catalog and the Intl tag
        - the picked locale is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false does not read the stored pick
        - persist: false does not write the picked locale
        - an app-supplied Ref is used as-is and outranks the stored pick
        - an app-supplied Ref is not persisted by the platform
    - switcher availability
        - enabled by default
        - switcher: false turns it off
        - a writable Ref keeps it on
        - a writable computed keeps it on
        - a readonly computed turns it off — writes would be swallowed
    - catalog completeness
        - English mirrors the German key structure exactly
        - no message is left empty in either locale
        - placeholders match between German and English
    - formatMessage
        - replaces named placeholders
        - leaves unknown placeholders verbatim
        - replaces every occurrence of the same placeholder
    - formatCurrency
        - German uses a decimal comma and dot grouping
        - English uses a decimal point and comma grouping
        - defaults to the platform locale
        - numeric strings are accepted
        - null, undefined and non-numeric input render as an em dash
        - zero is a real amount, not an empty value
    - mergeMessages / resolveMessages
        - overrides replace only the given leaves
        - keys absent from the base catalog are ignored
        - merging does not mutate the shared catalog
        - without overrides the shared catalog instance is returned
    - locale-aware navigation defaults
        - English labels and sections are the default
        - German locale switches labels and sections
        - explicit label overrides still win over the locale defaults
        - defaultSectionOrder matches the drawer order per locale
        - English sidebar groups under the English section order
    - createSaCatalog — the app owns the language set
        - ships German and English by default
        - an app can offer a single language
        - the offered order is the order given
        - a locale without a catalog is dropped instead of rendering blank
        - an empty selection falls back to everything available
        - an app-supplied language joins the switcher with its own name
        - a partial translation renders, filling gaps from basedOn
        - basedOn defaults to English rather than the reference locale
        - overrides apply to app-supplied languages too
        - has() answers for built-ins and app languages alike
        - resolution is cached — the same object comes back
    - createSuperAdminI18n — app-owned languages end to end
        - a single offered language hides the switcher
        - an app language can be selected and formats with its own tag
        - a stored pick the app no longer offers is ignored
        - an unknown active locale renders the default instead of blanking
        - storageKeyPrefix separates apps sharing one origin
    - helper modules reach app-supplied languages
        - discovery status labels follow an app language
        - relative-date wording follows an app language
        - bundle status labels follow an app language
        - untranslated keys in those namespaces fall back, not blank
        - overrides reach the same namespaces
- `packages/ui-vue-tenant/tests/component/tenant-i18n-provider.test.ts`
    - the tenant catalog reaches a child without a prop
        - an ancestor that provides is read by a grandchild
        - without a provider the shipped catalog fills in, so nothing renders blank
        - the provided catalog wins over the shipped one

<!-- END proof -->

### SC-LANG-002 — The admin interface falls back to English, the backend to German

🟢 Two answers to one question, and knowing which applies where matters: the shipped interface uses
English when nothing else is named, while several backend routes — registration and the public
price list among them — default to German. An installation that names its language everywhere
never meets the difference; one that relies on the default meets it as a screen in two languages.

_(Documented as it stands. One default for both belongs in a breaking change, because moving
either of them changes what an existing installation renders.)_

_Source:_ `docs/guides/upgrade-to-1.0.md` · current practice

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue-tenant/tests/component/tenant-i18n-provider.test.ts`
    - the tenant catalog reaches a child without a prop
        - an ancestor that provides is read by a grandchild
        - without a provider the shipped catalog fills in, so nothing renders blank
        - the provided catalog wins over the shipped one

<!-- END proof -->

### SC-LANG-003 — Which languages an application offers is the application's decision

🟢 SaaSiCat ships two complete ones and lets an installation narrow that set or add its own. A
language added by an installation is usable from its first translated key onwards, falling back
for the rest.

_Source:_ release 0.17.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/locale-switcher.test.ts`
    - LocaleSwitcher visibility
        - renders when the app offers several languages
        - renders nothing when the app opted out
        - a context from an older package version still shows it
    - LocaleSwitcher contents
        - the button shows the active language by its own name
        - an app-supplied language is labelled from availableLocales
        - an unknown active locale falls back to its code instead of blanking
        - the accessible label comes from the catalog
        - every offered language becomes a menu entry
    - LocaleSwitcher selection
        - picking an entry writes the shared locale
        - only the active entry carries the check mark

<!-- END proof -->

### SC-LANG-004 — A missing translation is never an empty line

🟢 Text a reader's own catalogue does not know falls back to the shipped English rather than
disappearing, and never to a bare internal code.

_Source:_ #243 · release 0.19.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/i18n.test.js`
    - i18n locales
        - German is the default locale
        - every locale has a catalog, an Intl tag and a switcher label
        - isSaBuiltinLocale accepts shipped locales and rejects anything else
    - createSuperAdminI18n
        - defaults to the platform locale
        - switching the locale swaps the catalog and the Intl tag
        - the picked locale is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false does not read the stored pick
        - persist: false does not write the picked locale
        - an app-supplied Ref is used as-is and outranks the stored pick
        - an app-supplied Ref is not persisted by the platform
    - switcher availability
        - enabled by default
        - switcher: false turns it off
        - a writable Ref keeps it on
        - a writable computed keeps it on
        - a readonly computed turns it off — writes would be swallowed
    - catalog completeness
        - English mirrors the German key structure exactly
        - no message is left empty in either locale
        - placeholders match between German and English
    - formatMessage
        - replaces named placeholders
        - leaves unknown placeholders verbatim
        - replaces every occurrence of the same placeholder
    - formatCurrency
        - German uses a decimal comma and dot grouping
        - English uses a decimal point and comma grouping
        - defaults to the platform locale
        - numeric strings are accepted
        - null, undefined and non-numeric input render as an em dash
        - zero is a real amount, not an empty value
    - mergeMessages / resolveMessages
        - overrides replace only the given leaves
        - keys absent from the base catalog are ignored
        - merging does not mutate the shared catalog
        - without overrides the shared catalog instance is returned
    - locale-aware navigation defaults
        - English labels and sections are the default
        - German locale switches labels and sections
        - explicit label overrides still win over the locale defaults
        - defaultSectionOrder matches the drawer order per locale
        - English sidebar groups under the English section order
    - createSaCatalog — the app owns the language set
        - ships German and English by default
        - an app can offer a single language
        - the offered order is the order given
        - a locale without a catalog is dropped instead of rendering blank
        - an empty selection falls back to everything available
        - an app-supplied language joins the switcher with its own name
        - a partial translation renders, filling gaps from basedOn
        - basedOn defaults to English rather than the reference locale
        - overrides apply to app-supplied languages too
        - has() answers for built-ins and app languages alike
        - resolution is cached — the same object comes back
    - createSuperAdminI18n — app-owned languages end to end
        - a single offered language hides the switcher
        - an app language can be selected and formats with its own tag
        - a stored pick the app no longer offers is ignored
        - an unknown active locale renders the default instead of blanking
        - storageKeyPrefix separates apps sharing one origin
    - helper modules reach app-supplied languages
        - discovery status labels follow an app language
        - relative-date wording follows an app language
        - bundle status labels follow an app language
        - untranslated keys in those namespaces fall back, not blank
        - overrides reach the same namespaces

<!-- END proof -->

### SC-LANG-005 — Every string on a screen follows the language that was chosen

🟢 Including the ones assembled from parts. An installation that added a third language got a shell
in that language with thirty-four sentences stranded in another.

_Source:_ release 0.18.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/i18n.test.js`
    - i18n locales
        - German is the default locale
        - every locale has a catalog, an Intl tag and a switcher label
        - isSaBuiltinLocale accepts shipped locales and rejects anything else
    - createSuperAdminI18n
        - defaults to the platform locale
        - switching the locale swaps the catalog and the Intl tag
        - the picked locale is written to storage
        - a stored pick outranks the app default
        - a corrupt stored value falls back to the app default
        - persist: false does not read the stored pick
        - persist: false does not write the picked locale
        - an app-supplied Ref is used as-is and outranks the stored pick
        - an app-supplied Ref is not persisted by the platform
    - switcher availability
        - enabled by default
        - switcher: false turns it off
        - a writable Ref keeps it on
        - a writable computed keeps it on
        - a readonly computed turns it off — writes would be swallowed
    - catalog completeness
        - English mirrors the German key structure exactly
        - no message is left empty in either locale
        - placeholders match between German and English
    - formatMessage
        - replaces named placeholders
        - leaves unknown placeholders verbatim
        - replaces every occurrence of the same placeholder
    - formatCurrency
        - German uses a decimal comma and dot grouping
        - English uses a decimal point and comma grouping
        - defaults to the platform locale
        - numeric strings are accepted
        - null, undefined and non-numeric input render as an em dash
        - zero is a real amount, not an empty value
    - mergeMessages / resolveMessages
        - overrides replace only the given leaves
        - keys absent from the base catalog are ignored
        - merging does not mutate the shared catalog
        - without overrides the shared catalog instance is returned
    - locale-aware navigation defaults
        - English labels and sections are the default
        - German locale switches labels and sections
        - explicit label overrides still win over the locale defaults
        - defaultSectionOrder matches the drawer order per locale
        - English sidebar groups under the English section order
    - createSaCatalog — the app owns the language set
        - ships German and English by default
        - an app can offer a single language
        - the offered order is the order given
        - a locale without a catalog is dropped instead of rendering blank
        - an empty selection falls back to everything available
        - an app-supplied language joins the switcher with its own name
        - a partial translation renders, filling gaps from basedOn
        - basedOn defaults to English rather than the reference locale
        - overrides apply to app-supplied languages too
        - has() answers for built-ins and app languages alike
        - resolution is cached — the same object comes back
    - createSuperAdminI18n — app-owned languages end to end
        - a single offered language hides the switcher
        - an app language can be selected and formats with its own tag
        - a stored pick the app no longer offers is ignored
        - an unknown active locale renders the default instead of blanking
        - storageKeyPrefix separates apps sharing one origin
    - helper modules reach app-supplied languages
        - discovery status labels follow an app language
        - relative-date wording follows an app language
        - bundle status labels follow an app language
        - untranslated keys in those namespaces fall back, not blank
        - overrides reach the same namespaces

<!-- END proof -->

### SC-LANG-006 — Text a customer reads carries its values beside its code, not inside a sentence

🟢 A sentence with the numbers baked into it cannot be rebuilt in another language by anyone
downstream. A tenant read "Current usage 11 exceeds the target limit 5" in English whatever
language they had chosen, and no integrator could reach it.

_Source:_ #243

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/error-params-contract.test.js`
    - error params contract
        - the sources contain coded throw sites at all
        - every throw site supplies the placeholders its message template names
        - all throw sites for one code agree on their params key names
- `packages/nest/tests/preview-issues-are-translatable.test.js`
    - a preview issue can be read in the reader’s language
        - the scan finds the codes at all
        - ${locale} has a text for every code the preview emits
        - every template names only values the issue carries
- `packages/ui-vue/tests/error-facts-are-declared.test.js`
    - the platform brand is on every class it decides for
        - there are error classes to look at — otherwise nothing below looks at anything
        - each status-carrying class calls markPlatformError(this)
        - the brands are counted independently, against a floor that moves with the sources
    - the empty-body sentinel is declared at its throw site
        - every status-0 platform error is marked as one
        - nothing else claims to be one
    - a seam whose answer can be "no body" first asks whether one arrived
        - the helpers are discoverable
        - each one calls requireServerAnswer before it reads a body
        - every file that raises the sentinel also runs the guard
- `packages/ui-vue-tenant/tests/component/a-blocker-speaks-the-apps-language.test.ts`
    - the blocker is read in the language the app chose
        - the shipped German catalogue renders the German sentence
        - the shipped English catalogue renders the English sentence
        - an app's own catalogue wins, in a language the platform does not ship
        - a code the app left untranslated still reads, from the shipped text
        - a code nobody has a text for falls back to the message the backend sent
- `packages/ui-vue-tenant/tests/component/message-parts.test.ts`
    - a message becomes parts
        - the substituted date is the emphasised one
        - other values are substituted without emphasis
        - a placeholder nobody supplied stays visible
        - an unclosed brace is left alone rather than eating the rest
        - a message without placeholders is one part
        - two dates are both emphasised

<!-- END proof -->

### SC-LANG-007 — A refusal code never encodes its own subject

🟢 The subject travels as a value beside the code. Building a code out of the quota or the plan it is
about made the set of codes grow with every quota an installation defines, so no catalogue of
translations could ever be complete.

_Source:_ #243

<!-- BEGIN proof -->

_Tested by:_

- `tests/a-refusal-code-is-a-constant.test.js`
    - a refusal code is a constant, not something built
        - there are shipped sources to look at
        - no shipped source assembles a code
        - the detector sees the shapes it was written for
        - and leaves alone the shapes that are not it

<!-- END proof -->

### SC-LANG-008 — A refusal is identified by a stable code; only its wording may change

🟢 The code is the contract. Renaming or removing one is a breaking change; rewording its text is
not, and which group a code is listed under is presentation only.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/error-messages.test.js`
    - shipped error messages
        - the code map carries the one code declared in another file
        - ${locale} has a text for every error code
        - ${locale} has no text for an unknown code
        - every locale interpolates the same placeholders per code
    - formatErrorMessage
        - substitutes named values
        - leaves an unknown placeholder visible rather than dropping it
        - treats null like a missing value
    - resolveErrorMessage
        - prefers the consumer override
        - falls back to the shipped default
        - falls back to the message when the code has no text
        - falls back to the code only when there is no message either
        - reads top-level body fields when a placeholder is not in params
        - params win over a top-level field of the same name
- `packages/nest/tests/error-params-contract.test.js`
    - error params contract
        - the sources contain coded throw sites at all
        - every throw site supplies the placeholders its message template names
        - all throw sites for one code agree on their params key names
- `packages/nest/tests/feature-guard.test.js`
    - StaticFeatureGuard — FEATURE_NOT_LICENSED body
        - emits the full FeatureNotLicensedBody with empty offers
- `packages/nest/tests/version-publish.test.js`
    - PublishValidationError
        - has name + code
- `tests/error-identity-across-entries.test.js`
    - AdminError across the CJS entries of @saasicat/ui-vue
        - the two entries really do hand out separate classes
        - instanceof does not survive the split
        - the brand does, and the error keeps everything it carried
        - a foreign error is still wrapped, so the brand is not a blanket pass
    - the declarations about a failure survive the split too
        - a transport failure marked through one entry is read back through the other
        - an empty response marked through one entry is read back through the other
        - an unmarked error is not mistaken for either

<!-- END proof -->

### SC-LANG-009 — An integrator resolves their own refusals and SaaSiCat's through one mechanism

🟢 An integrator's catalogue is mostly their own text, not a re-translation of the platform's, and
resolving both through one path is the reason the mechanism exists.

_Source:_ #244

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/preview-issues-are-translatable.test.js`
    - a preview issue can be read in the reader’s language
        - the scan finds the codes at all
        - ${locale} has a text for every code the preview emits
        - every template names only values the issue carries
- `packages/ui-vue-tenant/tests/component/a-blocker-speaks-the-apps-language.test.ts`
    - the blocker is read in the language the app chose
        - the shipped German catalogue renders the German sentence
        - the shipped English catalogue renders the English sentence
        - an app's own catalogue wins, in a language the platform does not ship
        - a code the app left untranslated still reads, from the shipped text
        - a code nobody has a text for falls back to the message the backend sent

<!-- END proof -->

### SC-LANG-010 — Diagnostics an integrator reads are English and are not translated

🟢 Boot failures, log lines and console messages are read by the person integrating SaaSiCat, and one
language is what makes them searchable. Translating them once put the platform's internal wording
on a tenant's screen instead of the catalogue's.

_Source:_ #150 · release 0.19.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/diagnostics-are-not-translated.test.js`
    - the diagnostics this package brands are not translated
        - the error classes are discoverable — otherwise nothing below looks at anything
        - no construction of one takes its message from the catalog
- `packages/ui-vue/tests/diagnostics-survive-the-locale.test.js`
    - the diagnostic of a failing seam does not depend on the UI language
        - ${name} says the same thing in German and in English
        - ${name} shows the operator the catalog's sentence, in their language

<!-- END proof -->

### SC-LANG-011 — Everything that ships is written in English

🟢 Code, comments, documentation, developer-facing errors, release notes and the command-line tools.

_Source:_ #150 · release 0.22.0

<!-- BEGIN proof -->

_Tested by:_

- `tests/what-ships-is-written-in-english.test.js`
    - what ships is written in English
        - there are shipped files to look at — otherwise nothing below looks at anything
        - none of them carries a German word
        - a catalogue that declares itself is skipped, and one that does not is not
        - the test tree and the release history are out of scope, the rest is in
        - the reader finds a German word wherever it stands, and only a whole one
        - a word that is also English is not on the list

<!-- END proof -->

### SC-LANG-012 — SaaSiCat carries no vocabulary from anybody's business

🟢 Shipped example text is neutral; an installation supplies its own wording for its own domain.

_Source:_ release 0.17.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-helpers.test.js`
    - slugify: the fallback carries no domain vocabulary
- `packages/ui-vue/tests/no-hardcoded-app-prefix.test.js`
    - Platform package: no hardcoded app URL prefixes
        - No composable/loader has `/api/(v1/)?{admin,billing}/...` as a default
    - Platform package: useTenants explicitly requires an endpoint
        - useTenants() WITHOUT the endpoint option throws with a clear error message

<!-- END proof -->

### SC-LANG-013 — A message says what to do next, not only what went wrong

🟢 A locked verification says to request a new code; a missing setting names the file and the field;
a refused booking names the plan and the rhythm it could not price.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/error-messages.test.js`
    - shipped error messages
        - the code map carries the one code declared in another file
        - ${locale} has a text for every error code
        - ${locale} has no text for an unknown code
        - every locale interpolates the same placeholders per code
    - formatErrorMessage
        - substitutes named values
        - leaves an unknown placeholder visible rather than dropping it
        - treats null like a missing value
    - resolveErrorMessage
        - prefers the consumer override
        - falls back to the shipped default
        - falls back to the message when the code has no text
        - falls back to the code only when there is no message either
        - reads top-level body fields when a placeholder is not in params
        - params win over a top-level field of the same name
- `packages/ui-vue/tests/admin-error.test.js`
    - AdminError
        - defaults to status 0 — a request that never produced one
        - the diagnostic message names the request, the status and the code
        - the diagnostic carries the detail when there is one
        - an explicit message overrides the derived one
        - cause is preserved
    - isAdminError
        - recognises an instance
        - rejects a plain error, a look-alike object, and nothing at all
    - isEmptyResponse
        - recognises what a throw site marked, and nothing else
        - the marker is not enumerable, so it does not leak into a log line
    - isTransportFailure
        - recognises what a client marked, and nothing else
        - marking a non-object is a no-op rather than a second failure
        - the marker is not enumerable, so it does not leak into a log line
    - toAdminError
        - passes an AdminError through untouched
        - reads an axios rejection: status, code, body, url and method
        - a status-bearing error with an unreadable body has no detail at all
        - joins a NestJS ValidationPipe message array instead of stringifying it
        - reads one of the package’s own API errors, which carry status and body
        - an answer that was empty is not a connection problem
        - a consumer client rejecting with status 0 is not an empty response
        - a manifest 304 that survives to be thrown is a diagnostic like any other
        - a real HTTP failure is not an empty response
        - a declared transport failure keeps its diagnostic off detail, so the catalog answers
        - an axios failure with no response is transport too
        - but an interceptor’s own error is not, however much of axios it carries
        - but an error from app code keeps its message — that IS what was said
        - wraps a thrown string
        - survives a thrown nothing
    - a transport failure is declared by the client, not read off the class
        - a null dereference is not a connection problem
        - a real fetch failure still says "check your connection"
        - a malformed URL is a transport failure too, not an unknown one
        - the client passes a response through untouched
    - toAdminError and consumer errors
        - a consumer error carrying a status keeps its message
        - a consumer error merely NAMED like ours is still a consumer error
    - emptyResponse is read off the throw site, not off the class
        - a mutation the server answered without a body is an empty response
        - a boot GET a client resolved as status 0 never reached the server
        - a manifest GET a client resolved as status 0 never reached the server
        - nor did a mutation a client resolved as status 0 — on any of the surfaces
        - a discovery load a client resolved as status 0 never reached the server
    - toAdminError and rejections that are not Errors
        - a plain object keeps the message it carries
        - an Error from another realm is such an object
        - an object with nothing readable falls through to the generic wording
        - a non-string message is not a message
    - adminErrorMessage
        - what the failing side said outranks anything the platform could guess
        - maps the statuses that have their own wording
        - any other status falls through to the generic template, with the number in it
        - a failure nothing knows anything about says so, rather than blaming the network
        - a seam that declares the request never went out gets the network wording
        - converts before formatting, so an axios rejection needs no pre-processing
        - German is a complete alternative, not a fallback to English
    - HttpJsonError is AdminError
        - the two names are one class, so an existing instanceof check keeps working
    - getJson / postJson raise AdminError
        - a non-2xx carries status, code, detail, url and method
        - postJson reports its own method
        - an error body that is not JSON does not become a second failure
        - a validation rejection keeps its constraints — the array is joined here too
        - a 2xx still returns the parsed body
    - httpStatusOf reads the status whichever shape carries it
        - an AdminError carries it at `status`
        - an axios rejection carries it at `response.status`
        - anything else has none

<!-- END proof -->
