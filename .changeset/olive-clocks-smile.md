---
'@saasicat/ui-vue': minor
---

Give a page one way to hold an async call, and one way to ask before it acts

Two composables and a port, all additive. No page changes behaviour in this
release; they are what the page migration will be built on.

**`useAsyncAction`** holds the shape the pages write out by hand roughly twenty
times: a flag set true before a call and false in `finally`, an error ref
cleared before and written in `catch`, and a toast on one or both outcomes.
Written out each time, the parts drift — some clear the error first and some do
not, some toast a failure and some only render it, and each one re-derives its
message from a raw `unknown`.

`run` does **not** re-throw. A wrapper that recorded the failure and threw it
again would leave every call site with the `try`/`catch` this exists to remove,
so the outcome is in the return value: `{ ok: true, value }` or
`{ ok: false, error }`. That is a deliberate departure from the sketch this was
planned against, which had it returning `Promise<T>`.

The first attempt returned `T | undefined`, and review caught that it cannot
answer for the actions this package has most of. `softDelete`, `discardDraft`
and `remove` resolve `Promise<void>`, so a successful call already produces
`undefined` and "undefined means it failed" was a signal that did not exist
there. Worse, TypeScript narrows the success branch of `void | undefined` to
`never` — the wrong call site compiles, lints clean, and silently never runs
its follow-up.

The success continuation runs **before** the success toast, and `pending` is
counted rather than set. Both came out of review: announcing success first meant
a continuation that failed produced "Saved" and then "reload failed" in that
order, and a second `run` before the first settled let the first one's `finally`
clear `pending` — releasing a button that was disabled precisely to stop the
second submit.

It carries an `errorMessage` hook, and that is not decoration. Five call sites
map a status and an error code to a specific sentence — a 422 carrying
`STRICT_MODE_VIOLATIONS` reads out the violations, a 401 says the session
expired. `AdminError` carries `status`, `code` and `body`, so that mapping is a
pure function of the error, and the hook is where it attaches. Without it those
five sites could not move.

**`useAsyncData`** is the read counterpart. On failure it puts `data` back to
`initial` rather than leaving what was there — which is what `useApiList`
already does, and the safer of the two: stale rows under an error message read
as current data, and nothing on the page says which reload they came from.

Loads are numbered, so a request a filter change abandoned cannot write over the
one that replaced it. Review found that gap: the older result won when it
resolved last, its `finally` cleared `pending` while the newer request was still
running, and — worst of the three — its `catch` reset `data` to `initial` and
raised an error for a filter the operator had already left.

**`UiConfirm`** is the seam a page asks through before doing something it cannot
undo, alongside the notify port it mirrors. `createSuperAdminApp({ confirm })`
replaces it; the default is Quasar's `Dialog`.

It resolves `{ ok, value? }` rather than a boolean, and that shape came from
counting the calls rather than from taste. Four pages reach for `useQuasar()`
today, and between them they raise **seven** dialogs, not four. Only three are
plain yes/no questions. Two more ask for an audit reason the backend requires
before it will reset a password or deactivate a user, and one asks for the date
a pilot is extended to. A port returning a boolean would have covered three of
seven and left the other four on a direct Quasar call — which is the thing the
port exists to remove. The wider shape matches the confirm provider
`useTenantActionFlow` already defines, so this is one idea in the codebase
rather than two.

One dialog is deliberately not modelled: `UsersPage` shows a generated one-time
password behind a single acknowledge button. It asks nothing, and giving it a
cancel button would let an operator dismiss a password that cannot be retrieved
again.

The Quasar default is safe as a fallback only because it still asks. An
implementation that resolved `{ ok: true }` outright would silently approve
every delete, revoke and deactivation — so there is no such default, and the
type says so.

---

The package README documented the opposite of this in the section next to the
notify port — _"Confirm dialogs inside the reference pages intentionally keep
using Quasar's `Dialog` — the pages are the Quasar layer."_ That decision is
reversed here, and the sentence is replaced rather than left to contradict the
code beside it.
