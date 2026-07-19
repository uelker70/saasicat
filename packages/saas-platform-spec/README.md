# @saasicat/spec

Sprach-neutrale Spec der SaaS-Plattform — JSON-Schemas, OpenAPI und
Acceptance-Test-Szenarien.

## Inhalt

| Datei                                   | Zweck                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| `schemas/admin-manifest.schema.json`    | UI-Discovery-Projektion einer App. SPEC §4.2                      |
| `schemas/plan-catalog.schema.json`      | Plan-Catalog-Format (`config/plans.yaml`). SPEC §4 + ROADMAP §3.1 |
| `schemas/promo-code.schema.json`        | Promo-Code-Format inkl. Redemption-Lifecycle                      |
| `schemas/audit-event.schema.json`       | Audit-Log-Eintrag-Format                                          |
| `admin-api.openapi.yaml`                | NORMATIVER REST-Vertrag des SuperAdmin-Backends                   |
| `acceptance/`                           | HTTP-Test-Szenarien (Stubs; Runner geplant)                       |
| `index.js` / `index.cjs` / `index.d.ts` | Re-Exports für JS/TS-Konsumenten                                  |

## Konsum

Im Konsumenten (z. B. AutohausPro-Backend):

```ts
import { adminManifestSchema, planCatalogSchema } from '@saasicat/spec';
import Ajv2020 from 'ajv/dist/2020';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateManifest = ajv.compile(adminManifestSchema);
const validateCatalog = ajv.compile(planCatalogSchema);

if (!validateManifest(myManifest)) console.error(validateManifest.errors);
if (!validateCatalog(myPlansYaml)) console.error(validateCatalog.errors);
```

Für Acceptance-Test-Szenarien als YAML lesen:

```ts
// im Acceptance-Test-Runner (geplant)
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

## Verbindliche Prinzipien

- **Sprach-neutral:** kein TS-Code, keine Runtime-Logik. Nur JSON-Schemas,
  YAML-OpenAPI und JSON-/YAML-Acceptance-Szenarien.
- **Keine fachliche Wahrheit:** das Schema beschreibt das _Format_, nicht die
  Daten. Plan-Catalog-Inhalt lebt in der Konsumenten-`config/plans.yaml`.
- **`schemaVersion` ist Pflicht** in jedem Top-Level-Schema. Major-Bumps
  brechen — das ist erlaubt, aber muss in einer Migrations-Notiz dokumentiert
  sein.
