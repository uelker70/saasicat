# @saasicat/spec

## What this is

Language-neutral spec of the SaaS platform — JSON Schemas, OpenAPI and
acceptance test scenarios.

## What this is not

Not runnable code. JSON Schemas, an OpenAPI document, Prisma fragments and SQL
constraints — a contract any language can implement, which is why the reference
implementation is a separate package.

Not a migration tool. The fragments are merged into your own `schema.prisma`
by `saasicat schema apply`, and your Prisma or Drizzle migration flow takes it
from there.

## Entry points

| Entry                         | What is in it                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `.`                           | The hand-written index: constants and helpers over the schemas.                                             |
| `./schemas/*.json`            | The JSON Schemas — the source of truth for every wire format.                                               |
| `./prisma-fragments/*.prisma` | One fragment per table group, merged by `saasicat schema apply`.                                            |
| `./prisma-fragments/`         | The directory itself, for tooling that enumerates the fragments.                                            |
| `./sql/*.sql`                 | The reference schema, the constraints Prisma cannot express, and the migrations a consumer applies by hand. |

## Contents

| File                                    | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `schemas/admin-manifest.schema.json`    | UI discovery projection of an app                 |
| `schemas/plan-catalog.schema.json`      | App identity config format (`config/saas.yaml`)   |
| `schemas/promo-code.schema.json`        | Promo code format incl. redemption lifecycle      |
| `schemas/audit-event.schema.json`       | Audit log entry format                            |
| `schemas/tenant-ledger.schema.json`     | A tenant's account: charges, payments, balance    |
| `admin-api.openapi.yaml`                | NORMATIVE REST contract of the SuperAdmin backend |
| `acceptance/`                           | HTTP test scenarios (stubs; runner planned)       |
| `index.js` / `index.cjs` / `index.d.ts` | Re-exports for JS/TS consumers                    |

## Usage

In a consuming backend:

```ts
import { adminManifestSchema, planCatalogSchema } from '@saasicat/spec';
import Ajv2020 from 'ajv/dist/2020';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateManifest = ajv.compile(adminManifestSchema);
const validateCatalog = ajv.compile(planCatalogSchema);

if (!validateManifest(myManifest)) console.error(validateManifest.errors);
if (!validateCatalog(mySaasYaml)) console.error(validateCatalog.errors);
```

Reading acceptance test scenarios as YAML:

```ts
// in the acceptance test runner (planned)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';

const specRoot = path.dirname(fileURLToPath(import.meta.resolve('@saasicat/spec/index.js')));
const scenarios = await glob('acceptance/**/*.yaml', { cwd: specRoot, absolute: true });
```

```bash
pnpm add @saasicat/spec
```

## Binding principles

- **Language-neutral:** no TS code, no runtime logic. Only JSON Schemas,
  YAML OpenAPI and JSON/YAML acceptance scenarios.
- **No domain truth:** the schema describes the _format_, not the data.
  App identity content lives in the consumer's `config/saas.yaml`; plans
  live in the DB, curated via the SuperAdmin UI.
- **`schemaVersion` is required** in every top-level schema. Major bumps
  break — that is allowed, but must be documented in a migration note.

## Next

- [Data model](../../docs/explanation/data-model.md) — the tables the fragments declare
- [From capability to contract](../../docs/explanation/capability-to-contract.md) — what the schemas
  describe
- [Codegen](../../docs/explanation/adr/0006-spec-to-types-codegen.md) — how types are derived from them
