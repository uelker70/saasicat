# @saasicat/cli

Cross-cutting helpers for consumer CLIs. Provides:

- `CliContextService` — identity / MFA / production-confirm / audit-tag
- `MfaSetupFlow` — `<app> admin mfa-setup`
- `WhoAmIFlow` — `<app> admin whoami`
- `AuditTailFlow` — `<app> audit tail` (via `AuditQueryPort`)
- `DoctorFlow` — `<app> doctor` with pluggable `DoctorCheck` list
- `ManifestCliFlow` + `DEFAULT_MANIFEST_CHECKS` (12 platform checks) —
  `<app> manifest dump|validate|hash|diff|check`

Spec: [`saas-platform-spec/cli-conventions.md`](../saas-platform-spec/cli-conventions.md).

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
        PlanCatalogModule.forRoot({ path: './config/plans.yaml' }),
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

Per [`cli-conventions.md`](../saas-platform-spec/cli-conventions.md) §6:

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
