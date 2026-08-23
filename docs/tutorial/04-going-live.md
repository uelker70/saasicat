# 4 — Going live

**About 20 minutes.** At the end you have a container that boots against a real
database, reports its health, and cannot be bootstrapped a second time by
someone who finds the setup endpoint.

## Migrations, not `db push`

```bash
pnpm exec saasicat schema migrate --all
pnpm exec saasicat schema check
```

`migrate` runs `apply`, then `prisma migrate dev --create-only`, then appends
`constraints.postgres.sql` to the migration it just produced and applies it.
That is what puts the invariants Prisma cannot express — the ones that make a
promo code claimable exactly once under concurrency — into the same migration as
the tables.

`check` is the one to put in CI. It exits 1 when your schema has fallen behind
the fragments a package upgrade brought, and reports what is missing by name.

## The setup token

First-run setup is public by necessity: before the first SUPER_ADMIN there is no
session to authenticate. Two things keep it closed:

- it answers only while **zero** SUPER_ADMIN exist, and
- it requires `SETUP_TOKEN` from the environment to match.

Set the variable for the first boot and remove it afterwards. Without it the
endpoint answers `SETUP_DISABLED`, which is the state you want in production.

## The health gate

The platform refuses to boot rather than start degraded. Two checks run before
the first request:

- **The enforcement chain.** Every annotated route needs a feature guard. An
  application that annotates 63 routes and installs no guard is not partially
  protected, it is unprotected — so that boot fails and says which routes.
- **Required ports.** A port the configuration says is required, with no
  adapter, fails the boot with the token name.

Where the platform degrades on purpose it says so once, at boot, naming what it
turned off. A capability that vanishes silently is indistinguishable from a bug
in your own code.

## The proof

```bash
docker compose up -d
docker compose logs backend | grep -i saasicat
```

You should see the discovery snapshot written, the manifest routes registered,
and no warning. Then:

- `GET /api/v1/admin/setup/status` answers `{ "needsSetup": false }`.
- The admin panel logs in and asks for a TOTP code on the first write.
- `GET /public/catalog` answers with the plans your customers can buy.

## What to read next

- [Verify your integration](../guides/verify-your-integration.md) — the full
  checklist, including the things that fail quietly.
- [Troubleshooting](../guides/troubleshooting.md) — the failures with causes
  that are not obvious from the message.
- [Upgrade to 1.0](../guides/upgrade-to-1.0.md) — if you started on a 0.x
  release.
