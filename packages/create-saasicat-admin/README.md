# create-saasicat-admin

Scaffolding CLI for SuperAdmin frontend projects. Generates a runnable
Vue 3 + Quasar + Vite project that builds on `@saasicat/ui-vue` and ships
all standard pages.

## Usage

```bash
pnpm create saasicat-admin <dir> \
  --project-key notesapp \
  --brand-name NotesApp \
  --logo-text NA \
  --api-base /api/v1/admin
```

Generates this directory structure:

```
<dir>/
├── package.json
├── vite.config.ts
├── index.html
├── tsconfig.json
├── src/
│   ├── main.ts                       (calls createSuperAdminApp)
│   ├── App.vue                       (<router-view />)
│   ├── services/http.ts              (HTTP client + adminLogin stub)
│   ├── router/routes.ts              (all standard pages)
│   └── styles/theme.scss
└── README.md
```

Afterwards:

```bash
cd <dir>
pnpm install
pnpm dev   # http://localhost:9100/admin/login
```

## Options

| Flag             | Default         | Purpose                                            |
| ---------------- | --------------- | -------------------------------------------------- |
| `--project-key`  | `app`           | used as prefix in storage keys + tokens            |
| `--brand-name`   | `App`           | shown in the AdminLayout header                    |
| `--logo-text`    | `AP`            | two-letter badge in the logo                       |
| `--api-base`     | `/api/v1/admin` | backend endpoint prefix                            |
| `--dev-port`     | `9100`          | Vite dev server port                               |
| `--backend-port` | `3000`          | backend port for the Vite proxy                    |
| `--no-install`   | false           | only generate files, skip the final `pnpm install` |

## What is left to do afterwards

1. `src/services/http.ts` → adapt `adminLogin()` to your auth flow.
2. Check the platform dependency versions in `package.json` — the templates
   reference the `@saasicat/*` packages via semver from npm.
3. Adapt the Vite proxy in `vite.config.ts` to your backend port.

Everything else comes from `@saasicat/ui-vue`.
