---
'@saasicat/types': minor
'@saasicat/ui-vue': patch
---

Ship default error texts in English and German

An error body carries a code and an English developer message. That leaves a
consumer two bad options: show English to end users, or translate 128 strings
before showing anything. For the 21 codes thrown as a bare `{ code }` —
most of the registration funnel, including every OTP failure — there is no
message at all, so the code itself was the only thing to display.

`ERROR_MESSAGES_EN` and `ERROR_MESSAGES_DE` now ship a text per code, and
`resolveErrorMessage` renders one: consumer override first, then the shipped
default, then the `message` from the body, and only then the bare code. Since
every coded exception carries a message, that last step is unreachable in
practice — a consumer that has not yet translated a new code shows English
prose, never `PLAN_VERSION_NOT_LIVE`.

The English texts are derived from the messages the backend actually sends, so
the shipped default cannot drift from the real one. Placeholders read `params`
first and the remaining body fields second, so a value already on the wire is
not duplicated into `params` just to be interpolated.

`error-messages.test.js` fails if any code lacks a text in any shipped locale,
or if two locales interpolate different values for the same code.

`formatMessage` in `@saasicat/ui-vue` now delegates to the same implementation
instead of keeping a byte-identical copy.
