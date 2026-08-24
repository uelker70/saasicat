# Build the admin frontend

The SuperAdmin UI is a Vue 3 + Quasar application that you own and the platform
fills: it ships the pages, the shell, the theme and the data layer, and your
app supplies auth, routes and its own screens.

`pnpm create saasicat-admin` writes all of this for you. Read on when you are
adding the admin to an application that already exists, or when you want to know
what the scaffolder wrote.

## Bundler: dedupe the peers — do this first

Add this to your Vite config before anything else in this chapter:

```ts
export default defineConfig({
    resolve: {
        // Exactly one copy of each. See below for why.
        dedupe: ['vue', 'vue-router', 'pinia', 'quasar'],
    },
    // …
});
```

**Why it is not optional.** `createSuperAdminApp()` _creates_ the router, the
Pinia instance and the Quasar plugin. Your own pages then read them back with
`useRoute()`, `useRouter()` and store hooks. Those APIs work by **module
identity** — `inject` with a key that is a module-level symbol — so two copies of
a library do not share one.

The package ships its pages as `.vue` **source**, so their
`import … from 'vue-router'` resolves relative to the package while your files
resolve relative to your app. If both resolve to different installs, the bundle
contains both.

**The symptom is not an error message.** `inject` returns `undefined`, so the
first thing that touches it throws somewhere unrelated:

```text
TypeError: Cannot read properties of undefined (reading 'params')
```

The shell renders — header, drawer, navigation — and the content area is blank.
Pages that read no route params keep working, so it looks like one broken page
rather than a broken wiring. `create-saasicat-admin` emits the `dedupe` block
for you; a hand-wired app has to add it.

The list is this package's `peerDependencies`, and that is the rule rather than a
coincidence: a peer dependency _is_ the declaration that the host owns exactly
one.

## Platform Loaders

Every request the admin UI makes goes through one `HttpClient`, so your app's auth,
base URL and retry logic apply everywhere. The package ships both implementations —
you do not write the adapter.

**If your app already has an axios instance**, hand it over. It keeps its
interceptors, so the auth header you already inject applies unchanged:

```ts
// services/platform-loaders.ts
import { createAxiosHttpClient, createPlatformLoaders } from '@saasicat/ui-vue';
import { api } from './api'; // your axios instance, baseURL '/api/v1'

// `projectKey` is the catalogue this admin administers — the same key your backend
// config uses. Name it: the shell binds the plan catalogue to it, and a shell that
// names no project is refused at boot rather than sending `?projectKey=`.
export const ADMIN_ENDPOINTS = { apiBase: '/api/v1/admin', projectKey: 'myapp' };

// The platform passes fully-qualified paths and your instance already carries
// `/api/v1`, so strip it back off or it is sent twice.
export const platformHttpClient = createAxiosHttpClient(api, { stripPrefix: '/api/v1' });

export const loaders = createPlatformLoaders({
    endpoints: ADMIN_ENDPOINTS,
    http: platformHttpClient,
    storageKeyPrefix: 'myapp:',
});
```

**If it does not**, use the `fetch` client and give it a headers hook. The hook runs
per request, so a token that changes between calls is picked up without rebuilding
anything:

```ts
import { createFetchHttpClient } from '@saasicat/ui-vue';

export const platformHttpClient = createFetchHttpClient({
    headers: () => {
        const token = localStorage.getItem('myapp-admin-token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    },
});
```

Two things worth knowing about both adapters:

- **No HTTP status throws.** A 304 is a cache hit, a 402 carries a limit payload, a
  409 carries a conflict — the platform reads the status itself, so every response is
  handed over intact. Only a failure with no response rejects, and the adapter
  rethrows what it caught: the `TypeError` from `fetch`, the original rejection from
  axios. It becomes an `AdminError` with `status: 0` one layer up, where the
  platform's callers pass it through `toAdminError` — so catch it there, or read
  `isTransportFailure(err)` if you are calling an adapter directly.
- **A transport failure is marked only where it can be proved.** `fetch` rejects only
  when no response arrived, so `createFetchHttpClient` marks every rejection it
  catches. `createAxiosHttpClient` marks the ones axios itself reports as "the request
  was made and nothing came back" — its own `isAxiosError` brand with a `request` and
  no `response`, which is a refused connection, a DNS failure, a timeout or an abort.
  Everything else keeps its own words: an interceptor that answers a 401 with
  `new Error('session expired')` reaches your operator with that sentence rather than
  with "check your connection".
- `createAxiosHttpClient` is typed **structurally** and does not import axios, so
  `@saasicat/ui-vue` adds no dependency to your install.

**If your own client or interceptor knows a request never left, say so.** Call
`markTransportFailure(err)` before rejecting — the fetch adapter does exactly that. A
replacement error carries no evidence either way, and the platform will not guess:
`new Error('cannot reach api')` after a dead socket and `new Error('session expired')`
after a 401 are the same object to everything downstream, so marking both would cost
the second one the only explanation it had. `isAxiosNoResponseError(err)` is exported
if you want the reading the axios adapter uses.

One case needs a word from you. `res.json()` has to know whether your instance hands
over the body as it arrived or a value it already parsed, and it reads that off the
config axios echoes on the response — correctly for a stock instance and for each of
`responseType: 'text'`, `transformResponse: []`, `transformResponse: null` and
`transitional: { forcedJSONParsing: false }`. If you replaced `transformResponse` with
a pipeline of your own, that reading no longer works: your array and axios's echo
identically, one opaque function each, so say which it is.

```ts
const api = axios.create({ transformResponse: [(data) => data] }); // hands over text

export const platformHttpClient = createAxiosHttpClient(api, {
    stripPrefix: '/api/v1',
    responseBody: 'raw', // 'decoded' if your pipeline parses
});
```

Leave `responseBody` alone otherwise — the default reads the response and needs no
help.

If the instance you hand over sets `responseType: 'arraybuffer'` or `'blob'`, the
body is decoded as UTF-8 and read like any other undecoded body — nothing to
configure. `responseType: 'stream'` is refused: a stream can be read once and not
synchronously, so neither `json()` nor `text()` could keep its promise.

`responseBody` also settles the one body that is otherwise ambiguous. Axios's own
transform turns a zero-byte response and the two bytes `""` — valid JSON meaning the
empty string — into the same empty `data`, and nothing on the response tells the two
apart. Left at `'auto'`, `res.json()` reads an empty `data` as no body and throws,
which is what `Response.json()` does. Say `responseBody: 'decoded'` and it is read as
the value your instance produced, so a `""` body arrives as `''` — and so does a
zero-byte one, because that is the same tie seen from the other side.

## Manifest Store

```ts
// stores/manifest.ts
import { createManifestStore } from '@saasicat/ui-vue';
import { loaders } from '../services/platform-loaders';

export const useManifestStore = createManifestStore({
    loader: loaders.manifestLoader,
    id: 'admin-manifest',
});
```

## Router

`createAdminRoutes()` supplies the shell every SuperAdmin app has: a public
`/login`, a fail-closed `/admin-error`, and `/admin` with its index redirect and
the catch-all that mounts manifest-declared project pages in the right order.
`standardAdminChildren()` fills in the platform's own screens.

```ts
// router/routes.ts
import type { RouteRecordRaw } from 'vue-router';
import { createAdminRoutes } from '@saasicat/ui-vue';
import { standardAdminChildren } from '@saasicat/ui-vue/pages';
import SuperAdminLoginPage from '@saasicat/ui-vue/auth/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/layouts/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';

export const appRoutes: RouteRecordRaw[] = createAdminRoutes({
    loginPage: SuperAdminLoginPage,
    adminLayout: AdminLayout,
    adminErrorPage: AdminManifestErrorPage,
    children: standardAdminChildren(),
});
```

Pass your own routes to `standardAdminChildren()` and yours win on a matching
path — that is how you replace one standard page without giving up the other
twelve:

```ts
children: standardAdminChildren([{ path: 'tenants', component: MyTenantsPage }]);
```

The error page is imported statically on purpose: a screen that reports a failed
load must not be behind a load of its own.

## App Bootstrap

```ts
// main.ts
import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import { type SuperAdminLoginAdapter, type ActionsMap } from '@saasicat/ui-vue';
import App from './App.vue';
import { appRoutes } from './router/routes';
import { ADMIN_ENDPOINTS, platformHttpClient } from './services/platform-loaders';
import { adminApi } from './services/admin-api';
import { useAuthStore, isAuthenticated } from './stores/auth';
import { useManifestStore } from './stores/manifest';

const loginAdapter: SuperAdminLoginAdapter = {
    async login(email, password) {
        const result = await useAuthStore().login(email, password);
        return result.ok ? { ok: true } : { ok: false, code: result.reason };
    },
};

const actions: ActionsMap = {
    'tenants.suspend': (i) => adminApi.tenants.suspend(i.row.slug, i.payload),
    'tenants.reactivate': (i) => adminApi.tenants.reactivate(i.row.slug),
    'myapp.tenants.export': (i) => adminApi.tenants.export(i.row.slug),
    // … list all actions declared in the manifest
};

const app = createSuperAdminApp({
    rootComponent: App,
    brand: { logoText: 'MA', name: 'MyApp Admin' },
    endpoints: ADMIN_ENDPOINTS,
    appRoutes,
    loginAdapter,
    actions,
    // The platform pages issue their own requests. Without the client they have
    // no way to carry your auth — the shell refuses to boot rather than
    // falling back to a bare `fetch()`.
    http: platformHttpClient,
    authGuard: { isAuthenticated, onUnauthenticated: () => '/login' },
    manifestGuard: {
        // Lazy store access: Pinia exists once createSuperAdminApp() has run.
        ensureLoaded: () => useManifestStore().ensureLoaded(),
        getManifest: () => useManifestStore().manifest,
        errorRoute: '/admin-error',
    },
});

app.mount('#app');
```

## Colour Scheme (Light / Dark)

The shell ships both themes. `createSuperAdminApp` wires them; the option is
there when you want to steer it:

```ts
const app = createSuperAdminApp({
    // …
    theme: { scheme: 'system' }, // 'light' | 'dark' | 'system' (default), or a Ref
});

app.theme.scheme.value = 'dark'; // switch at runtime
app.theme.resolved.value; // 'light' | 'dark' — what 'system' means right now
```

`'system'` subscribes to `prefers-color-scheme` rather than reading it once, so
an open tab follows the machine when somebody switches at sunset. Pass a `Ref`
instead to keep the value in your own store — the platform then does not persist
it, because it is yours. Inside any component, `useSaTheme()` returns the same
context.

**Out of the box** the `AdminLayout` header, the login card and the first-run
setup card each render a `ThemeSwitcher` offering light, dark and system. The
pick is stored under `saasicat.theme.scheme` and survives reloads. Drop the
control for a deployment that ships one appearance — or hand over a readonly
`computed` and it hides itself rather than presenting a dead switch:

```ts
createSuperAdminApp({ theme: { switcher: false } });
```

Below `sm` (600px) the header shows both switchers as icons without their
labels, and drops the role badge and the signed-in name and email — the badge
repeats the subtitle under the title, and the name costs that title the room it
needs. The avatar and the sign-out button stay: a header that runs out of room
shortens what it says before it removes anything you can press.

Several apps on one origin share that storage key. Separate them with
`theme.storageKeyPrefix: 'admin:'`, mirroring `i18n.storageKeyPrefix`. To place
the switcher in your own chrome as well — it renders nothing when disabled, so
it needs no guard around it:

```ts
import ThemeSwitcher from '@saasicat/ui-vue/ui/page/ThemeSwitcher.vue';
```

**You may already be done.** The bridge is two-directional: your own
`$q.dark.set(true)` moves the platform, and a switch here moves Quasar. Both
have to move together or half the screen ends up in the wrong theme — the
stylesheet paints the platform's surfaces, Quasar paints its own cards, dialogs
and steppers.

Note what that means for `'system'`. A hard `$q.dark.set(true)` or
`$q.dark.set(false)` is an instruction, so it replaces a `'system'` pick with
the scheme you named — there is no way to say "dark now, machine again later".
`$q.dark.set('auto')` says the same thing `'system'` does and arrives as
`'system'`, so an app with its own three-way control does not freeze the
operator's choice. That holds even when the scheme you name is the one
`'system'` was already resolving to — the bridge asks whether it wrote a value
itself, not whether the colour on screen changed. The one call it cannot read is
one that repeats the mode Quasar already holds (`$q.dark.set(true)` while it is
already `true`): nothing changes for the bridge to see, so the pick stays
`'system'`. Set `app.theme.scheme.value` when it has to stick.

For the same reason the stylesheet does **not** answer `prefers-color-scheme` on
its own: it cannot see Quasar's half. That is why following the operating system
lives in the composable, where both halves move together.

**`app.dispose()`** releases the OS subscription and the bridge. It only matters
where a shell is torn down while the page survives — hot reload, a
micro-frontend, two shells in one document. Without it the old bridge keeps
writing to the document at the next theme change and can overrule the new shell.

Which colours change and which deliberately do not — the brand, the dark chrome —
is in the [design guide](../explanation/design-guide.md#dark-mode), along with the rule for
overriding a role.

## Wrapper Pages: Dumb Components with Data Composables

Platform pages are deliberately _dumb_: they receive data + callbacks as props.
In the consumer, a thin wrapper marries composables to the page.
Example `AdminDiscoveryPage`:

```vue
<template>
    <PlatformDiscoveryPage
        :snapshot="snapshot"
        :capabilities="capabilities"
        :features="features"
        :quotas="quotas"
        :loading="loading"
        :error="error"
        :active-locales="activeLocales"
        :run-discovery="runDiscovery"
        :review-capability="reviewCapability"
        :set-feature-i18n="setFeatureI18n"
        :set-quota-i18n="setQuotaI18n"
        :set-feature-base="setFeatureBase"
        :set-quota-base="setQuotaBase"
    />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useCatalogEntries, useDiscovery } from '@saasicat/ui-vue';
import PlatformDiscoveryPage from '@saasicat/ui-vue/pages/DiscoveryPage.vue';
import { platformHttpClient } from '../services/platform-loaders';
import { useManifestStore } from '../stores/manifest';

const {
    snapshot,
    loading: snapLoading,
    error: snapError,
    reload,
    rescan,
} = useDiscovery({ endpoint: '/api/v1/admin/discovery', http: platformHttpClient });

const {
    capabilities,
    features,
    quotas,
    loading: entriesLoading,
    error: entriesError,
    load,
    reviewCapability,
    setFeatureI18n,
    setQuotaI18n,
    setFeatureBase,
    setQuotaBase,
    syncDiscovery,
} = useCatalogEntries({
    adminEndpoint: '/api/v1/admin',
    projectKey: 'myapp',
    http: platformHttpClient,
});

const manifestStore = useManifestStore();
const activeLocales = computed(() => manifestStore.manifest?.project?.availableLocales ?? ['de']);
const loading = computed(() => snapLoading.value || entriesLoading.value);
const error = computed(() => snapError.value ?? entriesError.value);

async function runDiscovery(): Promise<void> {
    await rescan();
    if (snapshot.value) await syncDiscovery(snapshot.value);
}

onMounted(() => {
    void load();
    void reload();
});
</script>
```

> **Anti-pattern:** Copying code from the standard pages into the consumer. Then the UI
> drifts on platform updates and you lose the i18n/action synchronization. Shared
> logic belongs in the platform packages — the app wrapper stays thin.

## UI Language (i18n)

The platform ships two complete catalogs — **German** (the reference that fixes
the key structure) and **English** — and deliberately nothing beyond that. Which
of them your app offers, whether it adds languages of its own, and what wording
it prefers is your decision, not the platform's. There is no `vue-i18n`
dependency: the catalogs are plain typed objects, so you get autocompletion and
a compile error when a key is missing.

**Out of the box** the `AdminLayout` header, the login card and the first-run
setup card each render a `LocaleSwitcher` offering both languages by their own
name. The pick is stored under `sa:locale` and survives reloads; when the browser
denies storage access, switching still works for the session. Switching
re-renders every catalog text, the sidebar labels and the drawer sections, and
`Intl` formatting follows along.

**Offer fewer languages.** Narrow the set and the switcher disappears on its own
— a control with one option is noise:

```ts
createSuperAdminApp({ i18n: { locales: ['en'] } });
```

The starting locale follows: an English-only app starts in English without
setting `locale`. A stored pick for a language you no longer offer is ignored.

**Add your own language.** No fork, no platform release:

```ts
createSuperAdminApp({
    i18n: {
        additionalLocales: {
            fr: {
                label: 'Français', // shown in the switcher
                intlLocale: 'fr-FR', // for dates and numbers
                basedOn: 'en', // fills whatever you leave out
                messages: { common: { save: 'Enregistrer' } },
            },
        },
    },
});
```

`messages` is a deep partial, so a translation is usable from its first key
onwards — untranslated keys render in `basedOn` (default `'en'`) instead of
showing blanks. Order the switcher with `locales: ['fr', 'en']`.

**Change individual words** without adding a language. Everything not listed
keeps the platform text:

```ts
createSuperAdminApp({
    i18n: {
        overrides: {
            en: { nav: { pages: { tenants: 'Dealerships' } } },
            de: { nav: { pages: { tenants: 'Autohäuser' } } },
        },
    },
});
```

**Choosing the starting language** — `'de'` when offered, otherwise the first
entry of `locales`. This is the default for a user who has not picked yet; a
stored pick outranks it. Three ways to take control:

```ts
// (a) No persistence: every reload starts at `locale` again.
createSuperAdminApp({ i18n: { locale: 'en', persist: false } });

// (b) No switcher at all, even with several languages on offer.
createSuperAdminApp({ i18n: { switcher: false } });

// (c) The app owns the value — e.g. bound to a user-profile setting. The
//     platform then neither reads nor writes storage; persisting is on you.
const uiLocale = ref<SaLocale>(loadUserPreference() ?? 'de');
const app = createSuperAdminApp({ i18n: { locale: uiLocale } });
uiLocale.value = 'en'; // or: app.i18n.locale.value = 'en'
```

Hand over a readonly `computed` and the switcher hides itself rather than
presenting a control whose writes go nowhere.

Several apps on one origin share the `sa:locale` key. Separate them with
`i18n.storageKeyPrefix: 'admin:'`, mirroring `createPlatformLoaders`.

To place the switcher in your own chrome as well — it renders nothing when
disabled, so it needs no guard around it:

```ts
import LocaleSwitcher from '@saasicat/ui-vue/ui/page/LocaleSwitcher.vue';
```

**Reading messages in your own components:**

```ts
import { useSaMessages, useSuperAdminI18n } from '@saasicat/ui-vue';

const msg = useSaMessages('tenants'); // namespace-focused
const { locale, intlLocale } = useSuperAdminI18n();
```

In the template `{{ msg.list.title }}`, in the script `msg.value.list.title`.
For placeholders use `formatMessage(msg.value.deleteConfirm, { name })`. Outside
a shell (isolated mounts, unit tests) the composables fall back to a default
instance, so no setup is required.

**Tenant-facing pages** (`@saasicat/ui-vue-tenant`) are embedded in the
consumer's own app rather than the SuperAdmin shell and therefore keep their
prop-based map (`TenantPlanSectionI18n`). They ship a German **and** an English
default (`DEFAULT_I18N_DE` / `DEFAULT_I18N_EN`, selected by
`defaultTenantPlanSectionI18n(locale)`); the `i18n` prop still overrides
individual keys.

That app needs one import that the SuperAdmin shell already has:

```ts
import '@saasicat/ui-vue/theme.css';
```

The tenant pages read the same colour roles as the admin — which is what lets
one `$primary` brand both — and without the stylesheet those roles resolve to
nothing. The file is safe to load next to your own design: every selector in it is either
a `.sa-`-prefixed class of ours or sits under `.sa-page`, so nothing reaches an
element of yours unless you use our class names. There is no bare element rule.
See `examples/notesapp/web/src/main.ts`.

It also will not change your app's appearance behind your back. The dark theme
fires on `$q.dark.set(true)` or on an explicit `data-sa-theme`, never on the
operating system — the stylesheet cannot see Quasar's cards and steppers, so it
must not decide for them. To follow the OS in an embedded app, say so:
`bindSaThemeToDocument(createSaTheme())` moves both halves together.

**Adding a language to the platform itself** — as opposed to your app — means
extending `SA_LOCALES`/`SA_INTL_LOCALES`/`SA_LOCALE_LABELS` and adding a variant
per namespace under `packages/ui-vue/src/client/i18n/messages/`.
The German object is the reference structure; the compiler rejects a translation
with missing or extra keys. For a single app, `additionalLocales` is the shorter
road.

## Overriding one operation

When one call has to go somewhere else — a legacy host, an approval recorded
around a publish — override that one operation and keep the rest:

```ts
createSuperAdminApp({
    http: platformHttp,
    resourceOverrides: {
        bundleVersions: {
            ops: {
                publish: async (next, versionId, options) => {
                    await recordApproval(versionId);
                    return next(versionId, options);
                },
            },
        },
    },
});
```

`next` is the platform's own implementation, so the wrapper decides what happens
around it rather than replacing it. Every other operation is untouched.

`createAdminResourceClient` is still exported for an app that wants to call the
admin API from its own code rather than through a page.

## The tenant-facing feature gate

For your app's own tenant UI (not the SuperAdmin), the platform provides
three building blocks that work together:

```ts
// main.ts of the tenant app
import { provideEntitlement, useTenantManifest } from '@saasicat/ui-vue';

const manifest = useTenantManifest({ endpoint: '/api/v1/tenant/manifest' });
// manifest.value → { planId, features, quotas, navigation }
// manifest.hasFeature('NOTES') → boolean

// If you keep using the older useEntitlement:
provideEntitlement(app, manifest); // FeatureGate + router guard use it
```

Then control visibility declaratively in templates:

```vue
<template>
    <FeatureGate feature="NOTES">
        <RouterLink to="/notes">Notes</RouterLink>
        <template #fallback>
            <span class="muted">Upgrade to Pro for notes</span>
        </template>
    </FeatureGate>
</template>

<script setup>
import FeatureGate from '@saasicat/ui-vue/ui/entitlement/FeatureGate.vue';
</script>
```

And block routes:

```ts
import { buildFeatureRouterGuard } from '@saasicat/ui-vue';

router.beforeEach(
    buildFeatureRouterGuard({
        getEntitlement: () => manifest,
        redirectTo: '/upgrade',
    }),
);

// Route meta:
{ path: '/notes', component: NotesPage, meta: { requiresFeature: 'NOTES' } }
```

> **Security note:** the frontend feature gate is **convenience, not
> protection**. The actual protection lives in the backend
> (`@RequireFeature` + `@EnforceQuota`). The frontend only hides
> buttons the backend would reject anyway.
