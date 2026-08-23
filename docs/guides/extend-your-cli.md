# Extend your CLI

Optional but strongly recommended integration for ops workflows.

```ts
// cli/cli.module.ts
@Module({
    imports: [
        PrismaModule,
        PlanCatalogModule.forRoot({/* like 6.4 */}),
        PlatformAdminModule.forRoot({/* like 6.5 */}),
        CliContextModule.forRoot({
            config: {
                adminEmailEnvVar: 'MYAPP_ADMIN_EMAIL',
                mfaSkipEnvVar: 'MYAPP_SKIP_MFA',
                isProductionEnvironment: () => process.env.MYAPP_ENV === 'production',
            },
            userPort: { useExisting: PrismaUserPortAdapter },
            auditQueryPort: { useExisting: PrismaAuditQueryAdapter },
            manifestAccessPort: { useExisting: AdminManifestService },
            doctorChecks: [
                // Platform defaults are NOT loaded automatically — list explicitly:
                new DatabaseReachableCheck(),
                new EmailServiceReachableCheck(),
            ],
        }),
    ],
    providers: [
        // App-specific commands:
        PaketApplyCommand,
        PilotCreateCommand,
        // Platform flow wrappers:
        AdminMfaSetupCommand, // wraps MfaSetupFlow
        AdminWhoAmICommand, // wraps WhoAmIFlow
        AuditTailCommand, // wraps AuditTailFlow
        DoctorCommand, // wraps DoctorFlow
        ManifestDumpCommand, // wraps ManifestCliFlow.dump
        ManifestHashCommand, // wraps ManifestCliFlow.hash
        ManifestValidateCommand, // wraps ManifestCliFlow.validate
        ManifestCheckCommand, // wraps ManifestCliFlow.check
    ],
})
export class CliModule {}
```

With this your app has, for example:

```bash
myapp admin mfa-setup --as taci@example.com
myapp admin whoami    --as taci@example.com
myapp audit tail      --since "2026-05-01" --limit 50
myapp doctor
myapp manifest dump | jq .
myapp manifest hash                                          # for CI pinning
myapp manifest check                                         # drift detection
```

**Exit codes** are standardized (see `@saasicat/spec/cli-conventions.md`):
`0=ok`, `1=user-error`, `2=identity`, `3=mfa`, `4=connectivity`, `5=permission`,
`6=conflict`, `7=drift`, `99=internal`.
