---
'@saasicat/nest': patch
---

A sign-up refuses at step 1 a tenant name that step 4 could not take as the
legal name

Step 4 makes the tenant name of step 1 the subscriber's legal name, and since
1.0.0-rc.26 refuses a detail with a character XML cannot hold, or a tab, line
feed or carriage return inside it. Step 1 took such a name, so the sign-up
stopped at step 4 with `SUBSCRIBER_DETAIL_INVALID` for `legalName`, a field its
form does not show, and went on only when started again.
`PendingRegistrationService.start` now refuses the name before anything is
stored or sent, with `422 SUBSCRIBER_DETAIL_INVALID` and `field: 'tenantName'`,
by the same rule step 4 holds. A sign-up started before this release with such
a name is still refused at step 4 and is started again.
