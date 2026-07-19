# create-saasicat-admin

Scaffold-CLI für SuperAdmin-Frontend-Projekte. Erzeugt ein lauffähiges
Vue 3 + Quasar + Vite-Projekt, das auf `@saasicat/ui-vue`
aufbaut und alle Standard-Pages bereitstellt.

## Verwendung

```bash
pnpm create saasicat-admin <dir> \
  --project-key notesapp \
  --brand-name NotesApp \
  --logo-text NA \
  --api-base /api/v1/admin
```

Erzeugt eine Verzeichnis-Struktur:

```
<dir>/
├── package.json
├── vite.config.ts
├── index.html
├── tsconfig.json
├── src/
│   ├── main.ts                       (createSuperAdminApp aufgerufen)
│   ├── App.vue                       (<router-view />)
│   ├── services/http.ts              (HTTP-Client + adminLogin-Stub)
│   ├── router/routes.ts              (alle Standard-Pages)
│   └── styles/theme.scss
└── README.md
```

Anschließend:

```bash
cd <dir>
pnpm install
pnpm dev   # http://localhost:9100/admin/login
```

## Optionen

| Flag             | Default         | Zweck                                              |
| ---------------- | --------------- | -------------------------------------------------- |
| `--project-key`  | `app`           | wird in Storage-Keys + Tokens als Prefix verwendet |
| `--brand-name`   | `App`           | im AdminLayout-Header sichtbar                     |
| `--logo-text`    | `AP`            | 2-Buchstaben-Badge im Logo                         |
| `--api-base`     | `/api/v1/admin` | Backend-Endpoint-Prefix                            |
| `--dev-port`     | `9100`          | Vite-Dev-Server-Port                               |
| `--backend-port` | `3000`          | Backend-Port für Vite-Proxy                        |
| `--no-install`   | false           | Erzeugt nur Dateien, kein `pnpm install` am Ende   |

## Was du danach noch tun musst

1. `src/services/http.ts` → `adminLogin()` an deinen Auth-Flow anpassen.
2. Plattform-Dependency-Versionen in `package.json` prüfen — die Templates
   referenzieren die `@saasicat/*`-Pakete per Semver von npm.
3. Vite-Proxy in `vite.config.ts` an deinen Backend-Port anpassen.

Alles andere kommt aus `@saasicat/ui-vue`.
