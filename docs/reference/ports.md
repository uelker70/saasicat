# Ports

Every seam between the platform and something it cannot own: a database, an
audit trail, an MFA secret, a tenant list. You implement the ones your
integration needs and bind them at module registration;
`@saasicat/adapter-prisma` and `@saasicat/adapter-drizzle` implement most of
them against the canonical schema already.

Why the seam is here, and what an adapter may and may not decide:
[ADR 0007](../explanation/adr/0007-ports-and-adapters.md).

Generated from `packages/core/src/ports` — 16 ports. Do not edit by hand:
`node scripts/gen-docs/index.mjs --write`.

## Administration

### `SubscriptionStatsPort`

Stats adapter for subscriptions.

| Member                                           | What it does |
| ------------------------------------------------ | ------------ |
| `getStats(): Promise<SubscriptionStatsSnapshot>` | —            |

### `PromoCodeStatsPort`

Stats adapter for promo codes.

| Member                                        | What it does |
| --------------------------------------------- | ------------ |
| `getStats(): Promise<PromoCodeStatsSnapshot>` | —            |

### `AuditStatsPort`

Stats adapter for the audit log.

| Member                                     | What it does                          |
| ------------------------------------------ | ------------------------------------- |
| `countSince(since: Date): Promise<number>` | Number of audit events since `since`. |

### `AuditPort`

Audit adapter: platform services write to the audit log through this interface.

| Member                                                                                                                                     | What it does |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `write(input: { actor: AdminActor entity: string; entityId: string; action: string; changes?: Record<string, unknown>; }): Promise<void>;` | —            |

### `AuditQueryPort`

Read/query adapter for audit logs.

| Member                                            | What it does |
| ------------------------------------------------- | ------------ |
| `list(filter: AuditQuery): Promise<AuditEntry[]>` | —            |

### `AdminResourcesPort`

One narrow backend boundary for the generic Tenant/User/Audit/Subscription SuperAdmin pages.

| Member                                                                                                                   | What it does |
| ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `listTenants(filter: AdminTenantListFilter): Promise<AdminTenantListRow[]>`                                              | —            |
| `getTenantDetail(slug: string): Promise<AdminTenantDetail \| null>`                                                      | —            |
| `setTenantActive( slug: string, active: boolean, subscriptionStatus: string, ): Promise<AdminTenantStateResult \| null>` | —            |
| `listUsers(filter: AdminUserListFilter): Promise<AdminUserListRow[]>`                                                    | —            |
| `listAudit(filter: AdminAuditListFilter): Promise<AuditEntry[]>`                                                         | —            |
| `listSubscriptions(): Promise<AdminSubscriptionListRow[]>`                                                               | —            |

### `ManifestAccessPort`

Read adapter for the current AdminManifest.

| Member                         | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `getManifest(): AdminManifest` | —                                                       |
| `rebuild?(): AdminManifest`    | Optional: forces a rebuild from the contributions (e.g. |

### `RlsBypassPort`

Adapter for the RLS bypass context.

| Member                                               | What it does |
| ---------------------------------------------------- | ------------ |
| `runWithBypass<T>(fn: () => Promise<T>): Promise<T>` | —            |

## Billing

### `SubscriptionUsagePort`

Read adapter for the UI/display form of a subscription.

| Member                                                                      | What it does |
| --------------------------------------------------------------------------- | ------------ |
| `findForTenant(tenantId: string): Promise<SubscriptionUsageRecord \| null>` | —            |

### `UsageSnapshotPort`

Returns the current usage for all quotaKeys of a tenant declared via `@DefinesQuota` (e.g.

| Member                                                        | What it does |
| ------------------------------------------------------------- | ------------ |
| `snapshot(tenantId: string): Promise<Record<string, number>>` | —            |

### `TenantSubscriptionWritePort`

Write adapter for tenant self-service mutations (`POST /billing/plan`, `/billing/cancel` etc.).

| Member                                                                                                                                                                                     | What it does                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changePlanImmediate( tenantId: string, input: ImmediatePlanChangeInput, ): Promise<{ plan: string billingCycle: string }>;`                                                               | Immediate change: set plan + cycle, clear pending fields, optionally reset the period.                                                             |
| `schedulePlanChange(tenantId: string, input: ScheduledPlanChangeInput): Promise<void>`                                                                                                     | Change at period end: set pending fields.                                                                                                          |
| `acceptPendingPlanVersion( tenantId: string, userId: string, now: Date, ): Promise<{ accepted: boolean acceptedAt: Date \| null; effectiveAt: Date \| null; alreadyAccepted: boolean; }>;` | Marks the pending PlanVersion as accepted.                                                                                                         |
| `cancelSubscription( tenantId: string, immediate: boolean, now: Date, ): Promise<{ canceledAt: Date \| null status: string }>;`                                                            | Cancel the subscription.                                                                                                                           |
| `applyOnboardingSelection?( tenantId: string, input: ApplyOnboardingSelectionInput, redeemPromo: RedeemPromoInTransactionCallback \| null, ): Promise<ApplyOnboardingSelectionResult>`     | Atomic onboarding creation: sets plan + cycle + period window AND optionally calls a promo-redeem callback — all in a single consumer transaction. |

## Core

### `TenantPort`

Adapter to the project's own tenant schema.

| Member                                                                  | What it does |
| ----------------------------------------------------------------------- | ------------ |
| `findById(id: string): Promise<TenantDto \| null>`                      | —            |
| `findBySlug(slug: string): Promise<TenantDto \| null>`                  | —            |
| `list(filter: TenantListFilter): Promise<Paginated<TenantDto>>`         | —            |
| `create(input: CreateTenantInput): Promise<TenantDto>`                  | —            |
| `setActive(id: string, active: boolean, reason: string): Promise<void>` | —            |
| `softDelete(id: string, reason: string): Promise<void>`                 | —            |

### `UserPort`

Adapter to the project's own user schema.

| Member                                                                                         | What it does |
| ---------------------------------------------------------------------------------------------- | ------------ |
| `findById(id: string): Promise<PlatformUserDto \| null>`                                       | —            |
| `findByEmail(email: string): Promise<PlatformUserDto \| null>`                                 | —            |
| `countActive(tenantId: string): Promise<number>`                                               | —            |
| `listForTenant(tenantId: string, filter: UserListFilter): Promise<Paginated<PlatformUserDto>>` | —            |
| `resetPassword(userId: string, newHash: string): Promise<void>`                                | —            |
| `hasRole(userId: string, role: PlatformRole): Promise<boolean>`                                | —            |

### `SuperAdminProvisioningPort`

Narrow port for the first-run setup (interface segregation): ONLY an existence check + creation of the first SUPER_ADMIN.

| Member                                                                        | What it does                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `countSuperAdmins(): Promise<number>`                                         | Number of active SUPER_ADMIN users — basis for the first-run setup guard.        |
| `createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto>` | Creates a new SUPER_ADMIN; throws `PlatformUserExistsError` if the email exists. |

### `UserManagementPort`

| Member                                                                                          | What it does                                                                     |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `countSuperAdmins(): Promise<number>`                                                           | Number of active SUPER_ADMIN users — basis for the first-run setup guard.        |
| `createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto>`                   | Creates a new SUPER_ADMIN; throws `PlatformUserExistsError` if the email exists. |
| `reassignTenantAdmin(tenantSlug: string, email: string): Promise<ReassignTenantAdminCliResult>` | Promotes an existing user to TENANT_ADMIN or creates an emergency admin.         |
| `listTenantUsers(tenantSlug: string): Promise<CliUserRow[]>`                                    | Lists a tenant's users (by slug) for `<app> user list`.                          |
| `triggerPasswordReset(email: string): Promise<PasswordResetCliResult>`                          | Triggers the app's own password reset (one-time password or OTP email).          |
| `deactivate(email: string, reason: string): Promise<PlatformUserDto>`                           | Deactivates a user (app-specific status).                                        |

### `MfaPort`

Adapter for MFA secret persistence.

| Member                                                             | What it does                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| `getSecret(userId: string): Promise<string \| null>`               | Returns the stored TOTP secret or null.               |
| `setSecret(userId: string, secret: string \| null): Promise<void>` | Persists or deletes (null) the TOTP secret.           |
| `isEnabled(userId: string): Promise<boolean>`                      | The platform calls this during the mfa-setup command. |
