# @saasicat/cli

## What this is

Cross-cutting helpers for consumer CLIs. Provides:

- `CliContextService` — identity / MFA / production-confirm / audit-tag
- `MfaSetupFlow` — `<app> admin mfa-setup`
- `WhoAmIFlow` — `<app> admin whoami`
- `AuditTailFlow` — `<app> audit tail` (via `AuditQueryPort`)
- `DoctorFlow` — `<app> doctor` with pluggable `DoctorCheck` list
- `ManifestCliFlow` + `DEFAULT_MANIFEST_CHECKS` (12 platform checks) —
  `<app> manifest dump|validate|hash|diff|check`

Spec: [`cli-conventions.md`][conventions] in `@saasicat/spec`.

## What this is not

Not a CLI. There is no binary here: these are `nest-commander` flows and
services you register in **your** application's CLI, so they run with your
DI container, your database connection and your configuration.

Not the schema tooling either — `saasicat schema apply|check|migrate` and
`saasicat init` ship in the `saasicat` binary of this package's `bin`, and
are documented in the quickstart rather than here.

## Plugin Architecture

Consumer CLIs are NestJS-Standalone applications based on
[`nest-commander`](https://docs.nestjs.com/recipes/nest-commander). They
import the platform modules and register their own commands.

```ts
// backend/src/cli/cli.module.ts
import { Module } from '@nestjs/common';
import { AdminModule, PlanCatalogModule } from '@saasicat/nest';
import { CliContextModule } from '@saasicat/cli';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaUserPortAdapter } from './adapters/prisma-user-port';
// ...

@Module({
    imports: [
        PrismaModule,
        PlanCatalogModule.forRoot({
            app: { name: 'MyApp' },
            currency: 'EUR',
            vatRate: 19,
            // The catalogue is read from the database, not from a file — the
            // CLI's `plan-catalog import` puts it there.
            sink: {
                useFactory: (p) => new PrismaPlanCatalogReadSink(p),
                inject: [PrismaService],
            },
        }),
        AdminModule.forRoot({
            mfaPort: { useFactory: (p) => new PrismaMfaAdapter(p), inject: [PrismaService] },
            auditPort: { useFactory: (p) => new PrismaAuditAdapter(p), inject: [PrismaService] },
            rlsBypassPort: new AsyncLocalRlsBypassAdapter(),
        }),
        CliContextModule.forRoot({
            config: {
                adminEmailEnvVar: 'MYAPP_ADMIN_EMAIL',
                mfaSkipEnvVar: 'MYAPP_SKIP_MFA',
                isProductionEnvironment: () => process.env.MYAPP_ENV === 'production',
            },
            userPort: { useFactory: (p) => new PrismaUserPortAdapter(p), inject: [PrismaService] },
            auditQueryPort: {
                useFactory: (p) => new PrismaAuditQueryAdapter(p),
                inject: [PrismaService],
            },
            manifestAccessPort: { useExisting: AdminManifestService },
            doctorChecks: [
                // Platform defaults are NOT loaded automatically — list them
                // explicitly here or add your own checks.
                new SmtpReachableCheck(),
                new ObjectStorageReachableCheck(),
            ],
        }),
    ],
    providers: [
        // App-specific commands (nest-commander @Command)
        PlanApplyCommand,
        PlanDiffCommand,
        PilotCreateCommand,
        PilotGrantCommand,
        DiscountAddCommand,
        AdminMfaSetupCommand, // wraps MfaSetupFlow
        AdminWhoAmICommand, // wraps WhoAmIFlow
        AuditTailCommand, // wraps AuditTailFlow
        DoctorCommand, // wraps DoctorFlow
        ManifestCommand, // wraps ManifestCliFlow (sub-commands)
    ],
})
export class CliModule {}
```

### Wrapping a flow as a `nest-commander` command

The flow classes are framework-agnostic. Wrap them in
`@Command()`-decorated classes:

```ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { CliError, MfaSetupFlow } from '@saasicat/cli';

@Command({ name: 'admin mfa-setup' })
export class AdminMfaSetupCommand extends CommandRunner {
    constructor(private readonly flow: MfaSetupFlow) {
        super();
    }

    async run(_args: string[], opts: { as?: string; force?: boolean }): Promise<void> {
        try {
            const result = await this.flow.run({
                asFlag: opts.as,
                issuer: 'MyApp SuperAdmin',
                force: opts.force,
            });
            console.log(this.flow.formatSetupResult(result));
        } catch (err) {
            if (err instanceof CliError) {
                console.error(`✗ ${err.message}`);
                process.exit(err.exitCode);
            }
            throw err;
        }
    }

    @Option({ flags: '--as <email>' }) parseAs(v: string) {
        return v;
    }
    @Option({ flags: '--force' }) parseForce() {
        return true;
    }
}
```

### Project-specific commands (plan / pilot / discount etc.)

These are NOT shipped with the platform — they live in the consumer
package as project-specific commands that orchestrate calls to the
platform services (`MfaService`, `EntitlementService`, `PlanCatalog`-
helpers, `AdminAuditService`, …).

The platform exports the building blocks; consumers compose their own
domain commands on top.

## Exit codes

Per [`cli-conventions.md`][conventions] §6:

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 0    | success (incl. dry-run with no changes) |
| 1    | user error / validation                 |
| 2    | identity / auth                         |
| 3    | MFA                                     |
| 4    | connectivity (e.g. doctor: error)       |
| 5    | permission                              |
| 6    | conflict                                |
| 7    | drift (e.g. manifest check: error)      |
| 99   | internal                                |

[conventions]: https://github.com/uelker70/saasicat/blob/main/packages/spec/cli-conventions.md

## Next

- [Extend your CLI](../../docs/guides/extend-your-cli.md) — registering these flows in your app
- [Quickstart](../../docs/quickstart.md) — `saasicat init`, `schema apply`, `schema check`
