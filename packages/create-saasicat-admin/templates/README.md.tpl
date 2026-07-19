# __BRAND_NAME__ Admin

SuperAdmin-Frontend für __BRAND_NAME__, erzeugt mit
`create-saasicat-admin`.

## Setup

```bash
pnpm install
pnpm dev
```

Erreichbar unter `http://localhost:__DEV_PORT__/admin/login`.

Backend muss unter `http://localhost:__BACKEND_PORT__` lauschen und
`__API_BASE__/manifest` ausliefern.

## TODO

- `src/services/http.ts#adminLogin` an dein Backend-Auth anpassen.
- Eigene Project-Pages in `src/router/routes.ts` ergänzen (mit
  `createProjectPageHostRoute()` als Catch-all).
- KPI-Cards, Tenant-Actions, Project-Pages in deinem Backend-Manifest
  registrieren (siehe `docs/saas-platform.md §6.6` im saasicat-Repo).
