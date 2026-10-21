---
'@saasicat/core': patch
'@saasicat/ui-vue-tenant': patch
---

A refusal's sentence says what is true wherever the code is thrown, and a plan
change refused for its reasons shows them

Five shipped sentences fitted only one of the places their code is thrown, and
a tenant read them on the others: an ended subscription "can no longer be
changed" rather than only its plan, a blocked plan change no longer says
"during onboarding", a cancellation that changed while ending at once is not
called a moved date, a request without a user is not said to lack a tenant,
and a cancelled bundle booking is not named by its internal id.

A plan change refused at the moment it is made — a version offer taken, a
switch to a retired version's replacement, a confirmed change in the wizard —
now lists the reasons the refusal carries under its sentence, worded as the
preview words its blockers; a quota used beyond what the new plan allows was
refused with no reason on screen. `resolveErrorMessage` also gives a sentence
that names a value the body did not bring way to the server's message, as the
administration does, rather than showing the placeholder.
