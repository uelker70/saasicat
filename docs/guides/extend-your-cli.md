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
        CatalogApplyCommand,
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
        // Where `maintenance` is on in SaaSiCatModule.forRoot:
        MaintenanceCliFlow,
        MaintenanceCommands,
        MaintenanceStatusCommand,
        MaintenanceAnnounceCommand,
        MaintenanceRescheduleCommand,
        MaintenanceCancelCommand,
        MaintenanceOnCommand,
        MaintenanceOffCommand,
        // Where tenant billing freezes contracts (`contractFreeze`):
        ContractRefreshCliFlow,
        ContractsCommands,
        ContractsRefreshCommand,
        // Where invoices are issued and the administration shows tenants:
        InvoiceCancelCliFlow,
        InvoiceExportCliFlow,
        InvoicesCommands,
        InvoicesCancelCommand,
        InvoicesExportCommand,
    ],
})
export class CliModule {}
```

The admin module binds the same `secretSealer` as the application, under the same key:
`admin mfa-setup` seals a SuperAdmin's secret here, and the application opens it when the code is
checked. A CLI with a key of its own enrols secrets the application turns away. See
[the SuperAdmin's second factor](wire-the-backend.md#the-superadmins-second-factor-is-sealed).

With this your app has, for example:

```bash
myapp admin mfa-setup --as taci@example.com
myapp admin whoami    --as taci@example.com
myapp audit tail      --since "2026-05-01" --limit 50
myapp doctor
myapp manifest dump | jq .
myapp manifest hash                                          # for CI pinning
myapp manifest check                                         # drift detection
myapp maintenance on --until 2026-10-02T23:00+02:00 --yes    # before a migration
myapp maintenance off --yes                                  # after the health check
myapp contracts refresh --all                                # what a new vocabulary would change
myapp invoices cancel --invoice AHP-2026-000123 \
    --reason "The billing address was wrong."                # what a cancellation would write
myapp invoices export --from 2026-01 --until 2026-12 \
    --as-of 2027-01-15T10:00 --locale de --out ./handover    # the year for a tax advisor
```

The `maintenance` commands ask for no second factor: a deploy script has nobody to type one. They
ask for the identity and, against production, `--yes`. See
[Take the application offline for a deploy](take-the-application-offline-for-a-deploy.md).

`contracts refresh` shows what carrying a changed feature vocabulary into the contracts in force
would change, and writes it only with `--apply`. See
[Change the feature vocabulary](change-the-feature-vocabulary.md).

`invoices cancel` shows the cancellation invoice and the replacement an issued invoice would be
corrected by, and writes them only with `--apply`, which asks for the second factor and, against
production, `--yes`. It names the invoice by the number on its document, which no other invoice of
the installation carries — an invoice of a tenant deleted since included —, and `--tenant acme` beside
it refuses an invoice issued for another tenant; `--correct
city=Bremen` corrects a detail the replacement names, `--deliver-to` gives the address both invoices
go to. `--line 2=not-owed` says that line 2 is not owed and `--line 2=24.50` that 24.50 of it is
still owed, net; repeat it for several lines. The amount takes a dot and at most two decimals — a
comma is refused rather than read as a locale would read it —, and the preview prints each line
that moves, from what to what, and the replacement's lines. After `--apply` it says what the
replacement took over as paid and what was credited — a payment that arrived since the preview
counts there. Exit code 6 is an invoice cancelled already, 1 every other refusal. See
[Cancelling an invoice](wire-the-backend.md#cancelling-an-invoice).

`invoices export` writes the ZIP the invoices page downloads: the invoices of the months as of the
moment `--as-of` names on the installation's clock — five minutes ago where none is —, the tables in
English unless `--locale de` asks for German separators and decimal commas. It writes into `--out`
or the current directory, under a name that carries the months, the moment and the language, and
never over a file that is there: exit code 6 says one is. It is a read, so it asks for the identity
and no second factor; the audit log records the operator, the months, the moment and the archive's
SHA-256, which the command prints. Exit code 1 is every other refusal. See
[The export for a tax advisor](wire-the-backend.md#the-export-for-a-tax-advisor).

**Exit codes** are standardized (see `@saasicat/spec/cli-conventions.md`):
`0=ok`, `1=user-error`, `2=identity`, `3=mfa`, `4=connectivity`, `5=permission`,
`6=conflict`, `7=drift`, `99=internal`.
