---
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/types': minor
---

Translate all user-facing strings to English

Exception messages, log output, validation messages and CLI output were partly
German. For an open-source package the shipped language has to be English, so
consuming apps can localise on their own terms.

Both feature guards keep `Feature` as the leading word of their 403 message
(`Feature X is not included in the current plan.`). Consumers that classify the
403 by matching the message text — autohauspro does — keep working. That text
match is a fragile contract, and the follow-up is to give every exception a
stable `code` so consumers can resolve their own i18n by code instead of by
message.

No API, no behaviour and no error-code change; only message text.
