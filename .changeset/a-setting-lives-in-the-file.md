---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
---

The notice period and the self-service plan blocks move into `config/saas.yaml`

Changing a cancellation notice period meant editing `main.ts` and redeploying.
Changing the VAT rate meant editing a YAML file. Two settings of the same kind,
two homes, and nobody had decided which home is for what.

`config/saas.yaml` gains a required `tenantBilling:` section, and
`TenantBillingModule.forRoot()` **loses** `cancellationNoticeDays` and
`selfServiceBlockedPlans`. They are removed rather than deprecated: a fallback
would be a second place the value can come from, which is the thing this change
exists to end — an operator reading the file has to be reading the value that is
running, with no "unless somebody passed it in code" attached.

```yaml
# config/saas.yaml
tenantBilling:
    cancellationNoticeDays:
        monthly: 30
        yearly: 30
    selfServiceBlockedPlans:
        asTarget: [ENTERPRISE]
        asSource: []
```

**Every existing `config/saas.yaml` stops loading until the block is added.**
The loader names the field it is missing — `tenantBilling.cancellationNoticeDays`
— rather than the schema path Ajv reports, because that message is the first
thing every installation meets on upgrade.

**Both members of each setting are required, and neither has a default.** A
silent `0` is a commercial decision too, just an invisible one, and so is a
missing `asTarget`, which would quietly say that self-service reaches every
plan. Write `0` and `[]` where that is what you mean: spelled out they are a
decision rather than an omission.

**Still passing either option refuses the boot**, with a sentence naming the
file. Silently ignoring it is the one outcome worth preventing loudly — the
value an operator set is the one they believe is running, so the application
would not fail, it would work differently until a customer's cancellation landed
a period late. The check stays for one minor release. An explicit `undefined`
is not a passed value and is accepted, so an application that builds its options
with a spread is not refused for a value it never set.

On the database-hydration path the settings are not in the database and never
will be, so `dbCatalog` forwards them from the same file it already forwards
`currency` from: `tenantBilling: SAAS_CONFIG.tenantBilling`.

`saasicat init` writes the block with defaults and prints what it wrote, the
values and the path — read off the document it generated rather than a list
beside the template.

`saasicat codemod v1` gains a step that names every place a moved option is
still passed, with its file and line. It does **not** remove them: the value is
a term somebody agreed, and deleting it from the code without writing it into
the file would leave the installation running on whatever the file happens to
say. The boot refusal is what makes reporting safe rather than lax.

`CancellationNoticePeriods` and `SelfServiceBlockedPlans` now come from
`@saasicat/core` and their members are required. `noticeDaysFor` takes the
object rather than `object | undefined` and no longer falls back to zero: the
rule moved from "infer zero when reading" to "refuse when loading".
