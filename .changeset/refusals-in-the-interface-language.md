---
'@saasicat/core': minor
'@saasicat/ui-vue': minor
---

The administration words a refusal in the language its interface is in

A refusal the platform answers with a code reads in German or English, as the
operator chose, with the values it carries — an invoice not yet archived is
named in the operator's language, where the banner showed the server's English.
The sentences are `@saasicat/core`'s catalogues, under
`errors.codes` in the admin's messages, so a language an application adds can
word them too. Where the code is not the platform's, or a value the sentence
names did not come with the refusal, the server's message shows as before.
`catalogueSentenceFor` in `@saasicat/core` is the step that decides it.
