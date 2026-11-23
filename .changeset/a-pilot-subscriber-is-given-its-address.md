---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

The pilot dialog asks for the subscriber's address

The pilot dialog asks for the street, a second line, postal code, city and
country of the pilot's subscriber, each stopped where the route would refuse
it (`subscriberContactMaxLengthOf`), and sends them as `subscriber`. Where a tax
adapter decides, the admin manifest says `subscriberAddressRequired`, and the
dialog does not submit without the street, postal code, city and country: the
pilot's first contract would otherwise be refused (`SC-SPEC-010`). Both pilot
dialogs now show the route's refusal in the interface's language, where every
one read as "Creation failed", and keep the prompt open for a wrong code,
where it closed. See "Your pilot route receives the subscriber's address" in
`docs/guides/upgrade-to-1.0.md`.

- `@saasicat/spec`, `@saasicat/core`: `AdminManifest.subscriberAddressRequired`.
- `@saasicat/nest`: the manifest sets it from the tax adapter.
  **Breaking:** under an adapter, `SubscriberService.assessNewSubscriber`
  refuses details without the full address with
  `SUBSCRIBER_IDENTITY_INCOMPLETE`, before the adapter is asked (`SC-SUB-048`).
- `@saasicat/ui-vue`: `PilotSubscriberAddress`, `pilotAddressGaps`,
  `pilotSubscriberOf`, `PILOT_SUBSCRIBER_ADDRESS_FIELDS`,
  `PilotSubscriberAddressField`, `PilotSubscriberAddressForm`.
  **Breaking:** a pilot route whose DTO refuses unknown keys declares
  `subscriber`; `useMfaPrompt().run` closes the prompt and rethrows a `401`
  saying `MFA_NOT_SET_UP` or `NOT_AUTHENTICATED`; the messages
  `common.errorSaveFailed`, `common.createFailed`,
  `pilots.mfa.invalidOrNotSetUp` and `pilots.mfa.notSetUp` are gone.
