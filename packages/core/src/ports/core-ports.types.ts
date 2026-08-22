// Core adapter ports shared by framework modules.

export type PlatformRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'TENANT_MEMBER';

export interface TenantDto {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    settings?: Record<string, unknown>;
    deletedAt: string | null;
}

export interface CreateTenantInput {
    slug: string;
    name: string;
    settings?: Record<string, unknown>;
}

export interface TenantListFilter {
    status?: 'active' | 'suspended' | 'deleted';
    plan?: string;
    search?: string;
    page?: number;
    pageSize?: number;
}

export interface Paginated<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
}

export interface PlatformUserDto {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    platformRole: PlatformRole;
    isActive: boolean;
    lastLoginAt: string | null;
    deletedAt: string | null;
}

export interface UserListFilter {
    search?: string;
    role?: PlatformRole;
    page?: number;
    pageSize?: number;
}

/** Adapter to the project's own tenant schema. */
export interface TenantPort {
    findById(id: string): Promise<TenantDto | null>;
    findBySlug(slug: string): Promise<TenantDto | null>;
    list(filter: TenantListFilter): Promise<Paginated<TenantDto>>;
    create(input: CreateTenantInput): Promise<TenantDto>;
    setActive(id: string, active: boolean, reason: string): Promise<void>;
    softDelete(id: string, reason: string): Promise<void>;
}

/** Adapter to the project's own user schema. */
export interface UserPort {
    findById(id: string): Promise<PlatformUserDto | null>;
    findByEmail(email: string): Promise<PlatformUserDto | null>;
    countActive(tenantId: string): Promise<number>;
    listForTenant(tenantId: string, filter: UserListFilter): Promise<Paginated<PlatformUserDto>>;
    resetPassword(userId: string, newHash: string): Promise<void>;
    hasRole(userId: string, role: PlatformRole): Promise<boolean>;
}

export interface CreateSuperAdminCliInput {
    email: string;
    /**
     * Plaintext password. The adapter hashes it with the app's own method
     * (argon2/bcrypt) — hashing therefore stays app-specific, the shared
     * command doesn't know the algorithm.
     */
    password: string;
    firstName?: string;
    lastName?: string;
}

export interface ReassignTenantAdminCliResult {
    user: PlatformUserDto;
    /** true if a new emergency admin was created (instead of a promotion). */
    created: boolean;
    /** Previous role on promotion; null on new creation. */
    previousRole: PlatformRole | null;
    /** On new creation: generated initial password that the admin passes on. */
    oneTimePassword?: string;
}

export interface PasswordResetCliResult {
    user: PlatformUserDto;
    /**
     * If the app generates a one-time password (instead of an OTP/reset email),
     * it's returned here so the command can output it out-of-band.
     */
    oneTimePassword?: string;
}

export interface CliUserRow {
    email: string;
    role: PlatformRole;
    status: string;
    lastLoginAt: string | null;
}

/**
 * Write/list operations for the shared `<app> user` CLI command. Separates
 * the app-specific schema mutations (password hashing, role mapping,
 * tenant relationship) from the generic command flow (identity/MFA/audit/output).
 * Consumers register an implementation via
 * `CliContextModule.forRoot({ userManagementPort })`.
 */
/**
 * Narrow port for the first-run setup (interface segregation): ONLY
 * an existence check + creation of the first SUPER_ADMIN. The `SetupModule` depends
 * solely on this — a consumer that only wants the setup wizard doesn't need to
 * implement tenant user management.
 */
export interface SuperAdminProvisioningPort {
    /** Number of active SUPER_ADMIN users — basis for the first-run setup guard. */
    countSuperAdmins(): Promise<number>;
    /** Creates a new SUPER_ADMIN; throws `PlatformUserExistsError` if the email exists. */
    createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto>;
}

export interface UserManagementPort extends SuperAdminProvisioningPort {
    /** Promotes an existing user to TENANT_ADMIN or creates an emergency admin. */
    reassignTenantAdmin(tenantSlug: string, email: string): Promise<ReassignTenantAdminCliResult>;
    /** Lists a tenant's users (by slug) for `<app> user list`. */
    listTenantUsers(tenantSlug: string): Promise<CliUserRow[]>;
    /** Triggers the app's own password reset (one-time password or OTP email). */
    triggerPasswordReset(email: string): Promise<PasswordResetCliResult>;
    /** Deactivates a user (app-specific status). */
    deactivate(email: string, reason: string): Promise<PlatformUserDto>;
}

/** Returns current usage for a limit dimension. */
export interface QuotaProvider {
    /** quotaKey, as declared via `@DefinesQuota({ key })`. */
    readonly key: string;
    count(tenantId: string): Promise<number>;
    /** Optional: cache TTL in seconds (default 30s). */
    readonly cacheTtlSeconds?: number;
}

/**
 * Password hashing adapter. The algorithm (argon2/bcrypt) stays app-specific;
 * platform flows that persist credentials (registration, SuperAdmin
 * bootstrap) hash through this port instead of choosing an algorithm.
 */
export interface PasswordHasher {
    hash(plain: string): Promise<string>;
    verify(hash: string, plain: string): Promise<boolean>;
}

/** Adapter for MFA secret persistence. */
export interface MfaPort {
    /** Returns the stored TOTP secret or null. */
    getSecret(userId: string): Promise<string | null>;
    /** Persists or deletes (null) the TOTP secret. */
    setSecret(userId: string, secret: string | null): Promise<void>;
    /** The platform calls this during the mfa-setup command. */
    isEnabled(userId: string): Promise<boolean>;
}

/**
 * Opaque transaction context. The consumer determines the concrete type
 * (e.g. `Prisma.TransactionClient`). Platform code only passes it
 * through — no content inspection.
 */
export type TransactionContext = unknown;

/**
 * Transaction runner — wrapper over `prisma.$transaction`,
 * Django `transaction.atomic`, etc.
 */
export interface TransactionRunner {
    run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
