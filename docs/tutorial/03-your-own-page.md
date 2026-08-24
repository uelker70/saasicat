# 3 — A page of your own

**About 20 minutes.** At the end, a page that belongs to your application
appears in the admin sidebar — and disappears when the capability behind it is
switched off, without a deployment.

## The idea

The admin panel renders what the manifest declares. Your backend contributes to
that manifest, so a page of yours is two things: an entry in the contribution,
and a component the frontend can resolve by key.

## Step 1 — Contribute the page

In the manifest contribution `saasicat init` wrote:

```ts
projectPages: [
    {
        key: 'notesapp.reports',
        path: 'reports',
        label: 'Reports',
        icon: 'insights',
        componentKey: 'NotesReportPage',
        requiredCapability: 'notes.reports.read',
    },
],
```

`path` is relative to `/admin`, and `componentKey` is the name the frontend
resolves. `requiredCapability` is the interesting one: the entry is only sent to
clients whose tenant has that capability, so switching it off in the catalogue
removes the page from the sidebar — for everyone, immediately, without a build.

## Step 2 — Resolve the component

In the admin application, the `extensions` map is where a key becomes a
component:

```ts
createSuperAdminApp({
    // …
    extensions: {
        NotesReportPage: () => import('./pages/NotesReportPage.vue'),
    },
});
```

A key with no entry here is not a crash: the catch-all route renders a page
saying which key it could not resolve, which is the failure you want when a
backend and a frontend are deployed minutes apart.

## Step 3 — Build the page from the skeleton

Use the same primitives the platform's own pages use, and yours will not look
like a guest:

```vue
<template>
    <AdminPage>
        <AdminHero title="Reports" subtitle="What your tenants did this month" />
        <AdminBody>
            <AdminSection title="Notes created">
                <AdminTable :rows="rows" :columns="columns" />
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>
```

The recipe, and the decision rules behind it, are in the
[design guide](../explanation/design-guide.md); the props each component takes
are in [the reference](../reference/ui-primitives.md).

## The proof

1. The page appears in the sidebar under `Reports`, at `/admin/reports`.
2. Retire `notes.reports.read` in the discovery screen. Reload: the entry is
   gone, and navigating to the path lands on the catch-all rather than a broken
   page.
3. Accept it again, and it comes back.

That loop — code declares, the catalogue decides, the UI follows — is the same
one that gated the 26th note in tutorial 1. It is the only mechanism here, and
it works for pages, KPI cards and tenant actions alike.

Next: [going live](04-going-live.md).
