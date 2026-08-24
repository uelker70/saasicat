# 1 — Your first plan

**About 20 minutes.** At the end, an endpoint in your application refuses the
26th note with `402 limit reached for notesMax: 25/25`, because the tenant is on
a plan that includes 25 — and you will have written four small files to get
there.

This is the shortest complete pass through the loop:

```text
Capability → Discovery → Packaging → Contract → Enforcement
```

Everything here is real: the application you build is
[`examples/notesapp`](https://github.com/uelker70/saasicat/tree/main/examples/notesapp),
and a test in this repository holds the files below against it.

## What you need

A NestJS 11 application with Prisma, PostgreSQL and some notion of a tenant —
a `tenantId` on the rows a request may touch. If you have none, build that
first; SaaSiCat extends a multi-tenant application, it does not make one.

Its `tsconfig.json` needs `"moduleResolution": "nodenext"` (or `node16` /
`bundler`), which is what `nest new` writes. `saasicat init` checks and refuses
with an explanation if it finds `"node"`.

## Step 1 — Install and generate

```bash
pnpm add @saasicat/core @saasicat/spec @saasicat/nest @saasicat/adapter-prisma @saasicat/cli
pnpm exec saasicat init --project-key=notesapp --quota=notes:Note
```

`init` writes the wiring: the app identity file, the persistence bundle, the
feature-UI registry, the manifest contribution, an admin module, one quota
provider — and it adds `SaaSiCatModule.forRoot(...)` to your `app.module.ts`.

Two things it deliberately leaves to you, because nothing can guess them: what
the quota counts, and the name of your auth guard. **The generated code does not
compile until you name the guard**, and that is on purpose — an empty
`guards: []` is how this platform is told an endpoint runs without
authentication, so a placeholder would publish your capability inventory.

## Step 2 — Say what the quota counts

`init` wrote a provider with the counting line left open. One query fills it:

<!-- from: examples/notesapp/src/saas/notes-quota.provider.ts -->

```ts
@Injectable()
@DefinesQuota({
    key: 'notesMax',
    label: 'Notes count',
    unit: 'count',
    policy: 'hardCap', // continuous | monthlyReset | hardCap — hardCap blocks at the limit
    feature: 'NOTES',
})
export class NotesQuotaProvider implements QuotaProvider {
    readonly key = 'notesMax';

    constructor(private readonly prisma: PrismaService) {}

    async count(tenantId: string): Promise<number> {
        return this.prisma.note.count({ where: { tenantId } });
    }
}
```

The decorator is the declaration — discovery reads it at boot, and it is what
makes `notesMax` a thing the product can sell. `count()` is what enforcement
calls at request time.

## Step 3 — Create the tables

```bash
pnpm exec saasicat schema migrate --all
```

That merges the platform's Prisma fragments into your `schema.prisma`, creates
the migration, and appends the constraints Prisma cannot express — the ones that
make a promo code claimable exactly once. Run `saasicat schema check` afterwards
whenever you upgrade; it exits 1 on drift and is worth a CI step.

## Step 4 — Declare the capability on the endpoint

Three decorators, and no platform code inside the handler:

<!-- from: examples/notesapp/src/notes/notes.controller.ts -->

```ts
@Post()
@ImplementsCapability('notes.create', {
    label: 'Create note',
    feature: 'NOTES',
    kind: 'endpoint',
    owner: 'notes',
})
@RequireFeature('NOTES')
@EnforceQuota('notesMax')
create(@Req() req: DemoRequest, @Body() dto: CreateNoteDto) {
    return this.notes.create(req.user.tenantId, dto);
}
```

- `@ImplementsCapability` is the product declaration: this endpoint is a
  capability, it belongs to the `NOTES` feature, and discovery will offer it for
  review.
- `@RequireFeature` answers 403 when the tenant's plan does not include `NOTES`.
- `@EnforceQuota` answers 402 when the count has reached the limit.

## Step 5 — Package it

`config/saas.yaml` — written by `init`, with the plans filled in:

<!-- from: examples/notesapp/config/saas.yaml -->

```yaml
plans:
    - id: STARTER
      name: Starter
      monthlyNet: 9
      yearlyNet: 90
      features: [NOTES]
      quotas:
          notesMax: 25
```

This is the static path: plans in the file, loaded at boot. Applications that
manage plans in the SuperAdmin UI leave the block out and use the database
catalogue instead — [tutorial 2](02-admin-ui.md) shows that screen.

## The proof

Start the application and create notes as a tenant on `STARTER`. The 26th one
comes back as:

```json
{
    "statusCode": 402,
    "code": "LIMIT_EXCEEDED",
    "message": "limit reached for notesMax: 25/25"
}
```

Nothing in `NotesController` checks a limit. The decorator declared it, the plan
sold it, and the platform enforced it — that is the whole loop, and everything
after this tutorial is a variation on it.

Next: [the admin UI](02-admin-ui.md), where a person can see and change all of
this without touching the YAML.
