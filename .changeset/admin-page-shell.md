---
'@saasicat/ui-vue': minor
---

Make the admin page structure a component contract

The repo had already tried to hold the admin pages to one page structure, as a
CSS naming convention: `sa-theme.css` asked pages to use `.sa-page-head`
"instead of creating their own BEM variants". Of the eighteen pages, seven
did. Four copied the header into their own BEM variant, four pushed it into a
sub-component, and one shipped its title in a `<div>` with no heading element
at all. `.sa-toolbar` had no users anywhere. A class name is advice, and advice
does not hold a structure together.

The structure is now three components in `components/admin-page/`, and the part
that makes it a contract is that `title` is a required prop: a page cannot
forget to instantiate `AdminHero` the way it could forget to add a class,
because `vue-tsc` rejects it.

```vue
<AdminPage>
  <AdminHero title="Plans & versions" subtitle="…">
    <template #actions><q-btn … /></template>
  </AdminHero>
  <AdminSection title="Active plans"> … </AdminSection>
</AdminPage>
```

`AdminHero` renders the page's only `<h1>`; `AdminSection` renders a
`<section>` whose `aria-labelledby` points at its own `<h2>`. The wiring is the
reason the section is a component: an unnamed `<section>` is not a landmark at
all, and naming one by hand needs an id unique per instance — the step
hand-written markup forgets.

**`<main>` now exists, once.** No page rendered one, and `AdminLayout` wrapped
the router view in a plain `<div>`, so the admin UI had no main landmark.
`PlansPage` was the sole exception via `<q-page>`, which renders `<main>`
itself — so moving the landmark into the layout would have nested one `<main>`
inside another. The layout owns it now and `PlansPage` no longer uses `QPage`.

**Breaking for CSS overrides: `.sa-toolbar` and `.sa-toolbar__search` are
gone.** They had no users in this repo or in either known consumer. `.sa-page`
and `.sa-section*` are new, and `.sa-page-head*` is unchanged — the classes
stay unscoped so a consumer app can still restyle `.sa-page-head__title` from
its own CSS.

Page props, emits and slots are unchanged, so wrappers around the standard
pages keep working untouched.

**Two collisions fixed.** `.sa-bundles__head` / `__title` / `__head-actions`
were defined in `BundlesPage`'s unscoped `<style>` but appeared nowhere in its
own template — they styled its child header, and their only other effect was
leaking onto `plans-page/PlanBundleOverview`, which reuses the same class
names and got `display: flex` plus `justify-content: space-between` it never
asked for. The rules are gone with the markup they styled.
`MarketingCatalogPage` was the second: `mc-` is now `sa-marketing-`, and
`plan-list/PlanList`'s `pl-` is `sa-plan-list-`, so the admin surface has one
prefix again.

**Also.** The first-run setup wizard's title is an `<h1>` instead of a `<div>`.
The landing-page preview inside the marketing catalog no longer uses `<h1>` for
its mock-up hero — assistive technology cannot tell a mock-up from the document
around it. `bundles-page/BundlesHeader.vue` is now `BundlesToolbar.vue` (it no
longer renders a header) and `discovery-page/DiscoveryHeader.vue` is gone,
absorbed into the page's hero. Neither was imported outside this package.

`tests-component/admin-page-shell.test.ts` holds the line: it mounts the
components and then reads every page source, failing on a hand-written
`.sa-page-head`, a stray `<h1>`, a `<main>` or a `QPage`.
