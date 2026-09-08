---
'@saasicat/nest': major
'@saasicat/cli': minor
---

`dbCatalog` names the file; it no longer takes the settings as values

On the database path — plans and features from the read sink, managed in the
SuperAdmin UI — `dbCatalog` used to take `app`, `currency`, `vatRate`,
`tenantBilling`, `marketing` and `notifications` as values. Every application
forwarded them from the `config/saas.yaml` it had loaded anyway, so "the file
defines, nothing else does" held by agreement: nothing stopped one from typing a
notice period straight into the block, and the record of the applied settings
had no file to name on this path.

`dbCatalog` takes the path of that file now, and the platform reads it:

```ts
// before
dbCatalog: {
    app: SAAS_CONFIG.app,
    currency: SAAS_CONFIG.currency,
    vatRate: SAAS_CONFIG.vatRate,
    tenantBilling: SAAS_CONFIG.tenantBilling,
    marketing: SAAS_CONFIG.marketing,
},
// after
dbCatalog: { path: 'config/saas.yaml' },
```

- The settings come from the file, the plans and the features from the sink. A
  `plans:` block still in the file — the seed for `saasicat catalog import` —
  is not read on this path.
- `${NAME}` references resolve from `process.env` unless `dbCatalog` passes an
  `env` of its own, as `loadPlanCatalogFromFile` does.
- The record of the applied settings names the file on both paths now; the
  sentence saying the values came in as code is left for an object handed to
  `planCatalog`.
- **A `dbCatalog` that still carries the values refuses the boot**
  (`catalog.db-catalog-names-the-file`), naming what the option takes, rather
  than being read: the values it carries are the ones an operator believes are
  running. A path with a value left beside it is refused the same way, and the
  refusal names the value.
- `saasicat codemod v1` names every such block with its file and line. It does
  not rewrite it: which file the values were forwarded from is a variable in
  another module more often than a literal, and a guess would be wrong
  quietly.

`PlanCatalogModule.forRoot()` is unchanged for applications that wire the
low-level modules themselves.
