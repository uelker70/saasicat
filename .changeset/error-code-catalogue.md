---
'@saasicat/types': minor
'@saasicat/nest': minor
'@saasicat/cli': patch
---

Give every exception a stable error code

Consumers had to classify errors by matching the message text — autohauspro
still does, with `data.message.includes('Feature')`. While the message is the
contract, no message can be reworded safely, and a package that ships English
text cannot be localised by its consumers.

`@saasicat/types` now exports a catalogue of 127 codes grouped by domain, plus
`PlatformErrorCode` and `PlatformErrorBody`. Every exception in
`@saasicat/nest` carries `{ code, message, params }`: the code is the
contract, `message` is an English developer-facing fallback, and `params`
holds the values previously only interpolated into the text, so a consumer can
render a translated sentence without scraping ids back out of the message.

Guards that reported through a `reason` field (MFA, promo rate limit,
IP rate limit, the limit-exceeded filter) now send `code` **and** `reason`.
`reason` is deprecated but retained, so nothing breaks.

Wire-shape note: NestJS turns a string argument into
`{ message, error, statusCode }` but passes an object argument through
verbatim. Coded errors therefore carry no `error`/`statusCode` in the body —
the HTTP status is on the response itself. No consumer in this workspace reads
those fields from the body.

Two known defects are documented in the catalogue and deliberately left for a
separate release, because fixing either changes the wire format:
`PLAN_VERSION_NOT_LIVE` covers two distinct causes, and
`SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` spells "cancel" with one L beside a
sibling that uses two.

Also repairs 28 strings that the previous translation left half-German
("is notehr buchbar", "not foundefunden") or untranslated.
