# create-saasicat-admin

## What this is

Scaffolding CLI for SuperAdmin frontend projects. Generates a runnable
Vue 3 + Quasar + Vite project that builds on `@saasicat/ui-vue` and ships
all standard pages.

## What this is not

Not a dependency. It runs once, writes a Vite + Vue 3 + Quasar project you
own, and is never installed into it. Nothing it writes is generated again
later — edit the files freely.

Not the backend. The scaffolded admin talks to a NestJS application that
already has `@saasicat/nest` wired; without one it starts and shows a login
screen it cannot get past.

## Usage

```bash
pnpm create saasicat-admin <dir> \
  --app-key notesapp \
  --brand-name NotesApp \
  --logo-text NA \
  --api-base /api/v1/admin
```

Generates this directory structure:

```text
<dir>/
├── package.json
├── vite.config.ts
├── index.html
├── tsconfig.json
├── src/
│   ├── main.ts                       (calls createSuperAdminApp)
│   ├── App.vue                       (<router-view />)
│   ├── services/http.ts              (HTTP client + adminLogin stub)
│   └── router/routes.ts              (all standard pages)
└── README.md
```

Afterwards:

```bash
cd <dir>
pnpm install
pnpm dev   # http://localhost:9100/admin/login
```

## Options

| Flag             | Default         | Purpose                                                      |
| ---------------- | --------------- | ------------------------------------------------------------ |
| `--app-key`      | `app`           | slug of the application; npm package name and storage prefix |
| `--brand-name`   | `App`           | shown in the AdminLayout header                              |
| `--logo-text`    | `AP`            | two-letter badge in the logo                                 |
| `--api-base`     | `/api/v1/admin` | backend endpoint prefix                                      |
| `--dev-port`     | `9100`          | Vite dev server port                                         |
| `--backend-port` | `3000`          | backend port for the Vite proxy                              |
| `--no-install`   | false           | only generate files, skip the final `pnpm install`           |

## What is left to do afterwards

1. `src/services/http.ts` → adapt `adminLogin()` to your auth flow.
2. Check the platform dependency versions in `package.json` — the templates
   reference the `@saasicat/*` packages via semver from npm.
3. Adapt the Vite proxy in `vite.config.ts` to your backend port.

Everything else comes from `@saasicat/ui-vue`.

## Next

- [Build the admin frontend](../../docs/guides/build-the-admin-frontend.md) — what the scaffolder
  wrote, explained
- [Design guide](../../docs/explanation/design-guide.md) — before you write a page of your own
