---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

A read-only settings screen: what is running, since when, and from where

`SettingsPage` joins the standard pages at `/admin/settings`, under _System_ in
the sidebar, mounted by `standardAdminChildren()` like the others. It answers
the question an operator has after editing `config/saas.yaml`: has it landed?
The moment the running configuration was applied and the file it came from are
the first things on the screen — the timestamp is the requirement, not
decoration — followed by what changed between two starts, leaf by leaf with
both values, and the running values themselves as the file spells them.

It edits nothing, and it will not: the file is the one place a setting lives.
The one action is marking a change as seen, which records who and when and is
audited. An installation whose adapter keeps no record is told so and still
sees its running values; a record that describes an earlier configuration is
named as stale rather than shown as current.

The page reads the `settings` resource — `GET /admin/settings` and
`POST /admin/settings/changes/{id}/acknowledge` — through the registry, so it
takes one optional prop, `resources`, and no callbacks. `settings` is a new
`StandardPageKey`; the platform grants `settings.read` wherever it mounts the
route, so an app that passes `includeSettingsController: false` gets no dead
sidebar entry. Labels ship in English and German under the new `settings`
message namespace.
