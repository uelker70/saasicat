---
'@saasicat/nest': minor
---

A value in `config/saas.yaml` may name an environment variable

`monthly: ${NOTICE_DAYS}` — written into the file and resolved from the
environment when the platform reads it, so one file serves local development and
production, wired differently by the deployment rather than by a second file.
`${NOTICE_DAYS:-0}` declares a default for a variable that is unset or empty.

The reference is resolved **before** the schema looks, so a variable standing
in for `monthly` is held to `integer, minimum: 0` like a number typed into the
file. The resolved text is read as the type the field declares: `14` becomes the
integer 14 where the field takes one, and `1234` stays the string `"1234"` where
`app.version` takes a string. Three things stop the boot, each with the field,
the variable and the way out in one sentence, and all of them at once rather
than one per restart:

- a variable nobody set and no default in the file;
- a value that does not fit the field — `NOTICE_DAYS=abc` is refused rather than
  becoming `NaN` or `0`, and the reading is strict: `1.5`, `1e3` and a leading
  space are not integers;
- a variable whose name says it holds a credential — `SECRET`, `TOKEN`,
  `PASSWORD`, a `PRIVATE_KEY`, an `API_KEY`. A value the file resolves is shown
  on the login page, quoted in errors and recorded; a secret stays in the
  environment and is read where it is used, which is what `setupTokenEnvVar`
  and its kind carry: the name of a variable, not its value. Recognition is by
  name, so a credential under an innocuous name is not caught, and a key is
  refused only when a qualifier says what kind it is.

References are resolved for the installation's own file only.
`loadPlanCatalogFromString` takes an `env` option and, without one, refuses a
document that carries a reference — so the catalogue import, which loads an
uploaded body through it, cannot be used to read the server's environment. The
refusal is a `PlanCatalogValidationError`, and the import already answers 400 to
that. A document without a reference loads exactly as before.

**A value that already contains the text `${NAME}` changes meaning.** A plan
tagline reading `Save ${AMOUNT}` used to be that text; it is now a reference to
a variable called `AMOUNT`, and there is no escape that writes a literal
`${NAME}` — the boot refuses the document, naming the field and the variable,
so the change is loud rather than silent. Rewrite the text. A `$` that opens no
well-formed reference — `$5`, `${`, `${9}` — is ordinary text as before.

Inside a YAML flow collection a bare `${X}` is a nested mapping to the parser,
so quote it there: `asTarget: ['${ENTERPRISE_PLAN}']`. See "A value may name an
environment variable" in
[`docs/guides/wire-the-backend.md`](https://github.com/uelker70/saasicat/blob/main/docs/guides/wire-the-backend.md).
