# __BRAND_NAME__ Admin

SuperAdmin frontend for __BRAND_NAME__, generated with
`create-saasicat-admin`.

## Setup

```bash
pnpm install
pnpm dev
```

Reachable at `http://localhost:__DEV_PORT__/admin/login`.

The backend must listen on `http://localhost:__BACKEND_PORT__` and
serve `__API_BASE__/manifest`.

## TODO

- Adapt `src/services/http.ts#adminLogin` to your backend auth.
- Add your own project pages in `src/router/routes.ts` (with
  `createProjectPageHostRoute()` as a catch-all).
- Register KPI cards, tenant actions and project pages in your backend
  manifest (see `docs/saas-platform.md §6.6` in the saasicat repo).
