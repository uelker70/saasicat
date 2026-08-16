---
'@saasicat/ui-vue': minor
---

Let the shell hold the endpoint, and let an app change one call without taking
over all of them

`SuperAdminEndpoints` gains `projectKey`. It is app-wide and constant, which is
why it belongs there: today every page takes it as a prop and every consumer
passes the same value again per route, with nothing keeping the copies in step.
Optional, defaulting to `''`, so an app that administers no catalogue need not
name one.

`createResourceRegistry` binds the platform's endpoint definitions to one
`(http, context)` and hands a page the operations already knowing where they
go. `useResource('plans')` is the whole of what a standard page needs to reach
its data, and it is typed against the roster: `useResource('plans').update(id,
data)` carries the argument types the descriptor declares, and an unknown key is
a compile error. The first attempt got that exactly backwards — the key
parameter erased the operations to a constraint whose `never[]` arguments made
every call with an argument a type error, while any misspelled resource name was
accepted. Review caught it; both directions are now checked.

The bootstrap installs the registry **only when the app names its client**. It
otherwise has a `defaultHttpClient()` fallback for its own `SUPER_ADMIN_HTTP_KEY`,
and handing that to the registry would have defeated the guarantee below from
the inside: existing pages would keep working through their own `getAuthToken`
options while anything reaching for `useResource()` collected 401s. Without a
client the registry is simply absent, and `useResource` says which of the two
reasons applies.

**`http` is required, with no fallback.** A registry that quietly reached for
`fetch` when nobody passed a client would send every request without the app's
`Authorization` header, and that failure is silent: the call 401s, one card
renders an em dash, and nothing is logged. Three such call sites existed in this
package and had to be found by reading. The error names the two clients the
package ships, so the fix is in the message.

**An override wraps rather than replaces**, and that is the property a
prop-based page cannot offer. A page that takes its behaviour as twenty-four
function props takes all of it or none: an app needing one call diverted must
supply the other twenty-three itself. Here it names the one:

```ts
createSuperAdminApp({
    resourceOverrides: {
        planVersions: {
            ops: {
                publish: async (next, id, options) => {
                    await recordApproval(id);
                    return next(id, { ...options, forceRegressive: false });
                },
            },
        },
    },
});
```

Everything else keeps the platform's implementation. A resource can also be
pointed at another path (`context: { apiBase: '/api/legacy/admin' }`) or sent
through a different client, each on its own.

Overriding an operation that does not exist fails at boot with the list of the
ones that do — a typo in an override is otherwise a call that silently keeps
the platform behaviour until someone notices the approval was never recorded.

Also collapsed here: two copies of the endpoint-defaulting logic, in the
bootstrap and in `createPlatformLoaders`. The compiler found them, because
`projectKey` was added to one and not the other — which is exactly what a
second copy of a default is for.

Nothing is removed. Pages keep their `projectKey` prop and their endpoint
options; this adds the place those will move to.
