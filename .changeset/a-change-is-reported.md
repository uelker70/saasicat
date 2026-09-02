---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
---

A configuration change is reported to the people the file names

`config/saas.yaml` gains an optional `notifications.settingsChanged` list of
addresses. When a start finds the applied settings changed since the previous
start, each address is mailed what moved — every leaf with both values, the
file it came from, and when the start noticed it — through a new `EmailPort`
bound as `adapters.email`:

```yaml
notifications:
    settingsChanged: [ops@example.com]
```

```ts
SaaSiCatModule.forRoot({ adapters: { email: MySmtpEmailPort } });
```

`EmailPort` is one method, `send({ to, subject, text })`; the platform composes
the text, in English like every other diagnostic it writes. It is not part of a
persistence bundle, because mail is not persistence.

**The record is unconditional; mail is the addition, never the substitute.** The
change is written to `settings_changes` before any mail goes out, and a mail
that cannot be sent is logged without stopping the others or the boot. Name
addresses and bind no port, and the boot log says once that they reach nobody.
Name nobody, and nothing is said: in-app only is what an installation of one
operator asked for, and a warning at a correct configuration teaches people to
skip warnings.

**A recorded change survives until an operator acknowledges it.**
`POST /admin/settings/changes/{id}/acknowledge` marks it seen with who and
when, keeps its first author when repeated, and is written to the audit trail as
`SETTINGS_CHANGE_ACKNOWLEDGE`. It answers `404 SETTINGS_CHANGE_NOT_FOUND` for an
id nothing recorded — and for an installation that keeps no record at all.

The list is itself a setting, so moving it is a change like any other — and the
mail about it goes to both lists: an address added learns everything from then
on, and an address taken off is told that once rather than going quiet.
