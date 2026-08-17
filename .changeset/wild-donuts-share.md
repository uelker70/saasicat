---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

Refuse a project-scoped resource that has no project, at boot

A shell configured without `endpoints.projectKey` bound the plan catalogue to an
empty one, and nothing downstream objected. `?projectKey=` is a perfectly valid
request: an admin API that filters on it answers for no project at all, so the
catalogue rendered as an empty catalogue — no error, no empty-state hint, nothing
saying the shell was misconfigured. The same context put `projectKey: ''` into a
create body, where it finally failed validation, one operator action and one
screen later than the mistake. `usePlans()` has refused this at construction from
the start; a page reaching the same endpoints through the registry did not.

`bindResource` now refuses it where the resource is bound — which is boot, for
both `createResourceRegistry()` and `createSuperAdminApp()` — naming the option:

```text
Resource "plans" is project-scoped, but the context it is bound to names no
project. … Name the project this admin administers — `endpoints.projectKey` for
createSuperAdminApp(), `context.projectKey` for createResourceRegistry().
```

**Per descriptor, not per registry.** A descriptor declares `projectScoped`, and
only those are refused. That is not a stylistic choice: of the four platform
resources exactly one reads `ctx.projectKey`, so a demand made once for the whole
registry would refuse an admin that lists tenants and reads the audit trail over
a value those endpoints never send. `defineResource()` takes the declaration as
a third argument, and a test drives every operation through a recording context
and fails when a declaration and what the operations actually read disagree in
either direction — so the flag cannot go stale as the roster grows.

**What an app has to do:** name `projectKey` in the endpoints it hands
`createSuperAdminApp()` if it also passes `http`. The scaffolded template now
does, and `examples/notesapp/admin` — which had been running with an empty one —
sets `projectKey: 'notesapp'`. An app that passes no `http` client gets no
registry and needs no project.
