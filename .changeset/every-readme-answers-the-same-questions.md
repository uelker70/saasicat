---
'@saasicat/adapter-drizzle': patch
'@saasicat/adapter-prisma': patch
'@saasicat/cli': patch
'@saasicat/core': patch
'@saasicat/nest': patch
'@saasicat/persistence-testing': patch
'@saasicat/spec': patch
'@saasicat/ui-vue': patch
'@saasicat/ui-vue-tenant': patch
'create-saasicat-admin': patch
'saasicat': patch
---

Every package README now answers the same three questions in the same order:
what this is, what this is **not**, and where to go next.

The middle one is the addition. `@saasicat/core` is not a types-only package,
`@saasicat/spec` does not run your migrations, `@saasicat/cli` has no binary of
its own for the flows it ships, and `@saasicat/ui-vue-tenant` renders in your
application rather than in the admin — each of those was a question rather than
a sentence.

`@saasicat/nest` and `@saasicat/ui-vue` list all twelve and thirteen of their
entry points with what is in each and when to take it; the previous tables
covered one and four. A repository test checks those tables against the export
map in both directions.
