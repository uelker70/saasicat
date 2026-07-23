# NotesApp Admin

SuperAdmin frontend for NotesApp, generated with
`create-saasicat-admin`.

## Setup

```bash
pnpm install
pnpm dev
```

Reachable at `http://localhost:9100/admin/login`.

The backend must listen on `http://localhost:3000` and
serve `/api/v1/admin/manifest`.

## TODO

- Adapt `src/services/http.ts#adminLogin` to your backend auth.
- Add your own project pages in `src/router/routes.ts` (with
  `createProjectPageHostRoute()` as a catch-all).
- Register KPI cards, tenant actions and project pages in your backend
  manifest (see `docs/saas-platform.md §6.6` in the saasicat repo).
