# 2 — The admin panel

**About 15 minutes.** At the end you are logged into a SuperAdmin panel that
shows the plan from [tutorial 1](01-first-plan.md), the tenants on it, and the
capability your endpoint declared — and you can switch it to dark mode.

## Step 1 — Scaffold it

```bash
pnpm create saasicat-admin admin --api-base /api/v1/admin
```

One command writes a Vite + Vue 3 + Quasar application you own: routes, the
platform loaders, an HTTP client with your auth header, and the thirteen
standard pages mounted behind `AdminLayout`. Nothing in it is regenerated later
— edit it freely.

```bash
cd admin && pnpm install && pnpm dev
```

## Step 2 — Create the first SuperAdmin

There is no admin yet, and no way to log in to create one. That is what the
first-run setup is for: while zero SUPER_ADMIN exist **and** the operator has
set `SETUP_TOKEN`, the login screen offers a wizard instead of a password field.

```bash
SETUP_TOKEN=$(openssl rand -hex 16)
```

Put it in the backend's environment, restart it, and open the admin. The wizard
asks for the token, an email and a password, shows a QR code for TOTP, and
disables itself the moment the account exists — the endpoint answers
`SETUP_ALREADY_DONE` from then on.

Scan the code before leaving the page. Every write in the panel is MFA-gated,
and the secret is shown once.

## The proof

Signed in, you should see:

- **Discovery** — `notes.create`, waiting for review. That is the decorator from
  tutorial 1 arriving as product input.
- **Plans** — `STARTER` with `notesMax: 25`, exactly what the YAML declares.
- **Tenants** — the tenants your application has, with the plan each is on.
- The theme switcher in the header. Light, dark, or follow the machine.

## What you just saw

The panel is not reading your database. It is reading **the manifest** — one
endpoint, `GET /api/v1/admin/manifest`, that answers with the pages this
installation has, the KPI cards it shows, and the actions it offers. That is why
the admin frontend needs no knowledge of your domain, and why
[tutorial 3](03-your-own-page.md) can add a page of your own to it without
touching the platform.

Next: [your own page](03-your-own-page.md).
