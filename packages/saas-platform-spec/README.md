# @saasicat/spec

Language-neutral spec of the SaaS platform — JSON Schemas, OpenAPI and
acceptance test scenarios.

## Contents

| File                                    | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `schemas/admin-manifest.schema.json`    | UI discovery projection of an app                 |
| `schemas/plan-catalog.schema.json`      | App identity config format (`config/saas.yaml`)   |
| `schemas/promo-code.schema.json`        | Promo code format incl. redemption lifecycle      |
| `schemas/audit-event.schema.json`       | Audit log entry format                            |
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
