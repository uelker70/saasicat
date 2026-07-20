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

/** Adapter zum projekt-eigenen Tenant-Schema. */
export interface TenantPort {
    findById(id: string): Promise<TenantDto | null>;
    findBySlug(slug: string): Promise<TenantDto | null>;
    list(filter: TenantListFilter): Promise<Paginated<TenantDto>>;
    create(input: CreateTenantInput): Promise<TenantDto>;
    setActive(id: string, active: boolean, reason: string): Promise<void>;
    softDelete(id: string, reason: string): Promise<void>;
}

/** Adapter zum projekt-eigenen User-Schema. */
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
     * Klartext-Passwort. Der Adapter hasht es mit dem app-eigenen Verfahren
     * (argon2/bcrypt) — Hashing bleibt damit app-spezifisch, der geteilte
     * Command kennt den Algorithmus nicht.
     */
    password: string;
    firstName?: string;
    lastName?: string;
}

export interface ReassignTenantAdminCliResult {
    user: PlatformUserDto;
    /** true, wenn ein neuer Notfall-Admin angelegt wurde (statt Promotion). */
    created: boolean;
    /** Vorherige Rolle bei Promotion; null bei Neuanlage. */
    previousRole: PlatformRole | null;
    /** Bei Neuanlage: generiertes Initial-Passwort, das der Admin weitergibt. */
    oneTimePassword?: string;
}

export interface PasswordResetCliResult {
    user: PlatformUserDto;
    /**
     * Falls die App ein Einmal-Passwort generiert (statt einer OTP-/Reset-Mail),
     * wird es hier zurückgegeben, damit der Command es out-of-band ausgeben kann.
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
 * Schreib-/Listen-Operationen für das geteilte `<app> user`-CLI-Command. Trennt
 * die app-spezifischen Schema-Mutationen (Passwort-Hashing, Rollen-Mapping,
 * Tenant-Beziehung) vom generischen Command-Ablauf (Identity/MFA/Audit/Output).
 * Konsumenten registrieren eine Implementierung über
 * `CliContextModule.forRoot({ userManagementPort })`.
 */
/**
 * Schmaler Port für den First-Run-Setup (Interface-Segregation): NUR
 * Existenz-Check + Anlage des ersten SUPER_ADMIN. Das `SetupModule` hängt allein
 * hiervon ab — ein Konsument, der nur den Setup-Wizard will, muss kein
 * Tenant-User-Management implementieren.
 */
export interface SuperAdminProvisioningPort {
    /** Anzahl aktiver SUPER_ADMIN-User — Basis für den First-Run-Setup-Guard. */
    countSuperAdmins(): Promise<number>;
    /** Legt einen neuen SUPER_ADMIN an; wirft `PlatformUserExistsError`, wenn die E-Mail existiert. */
    createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto>;
}

export interface UserManagementPort extends SuperAdminProvisioningPort {
    /** Befördert einen bestehenden User zum TENANT_ADMIN oder legt einen Notfall-Admin an. */
    reassignTenantAdmin(tenantSlug: string, email: string): Promise<ReassignTenantAdminCliResult>;
    /** Listet die User eines Tenants (per Slug) für `<app> user list`. */
    listTenantUsers(tenantSlug: string): Promise<CliUserRow[]>;
    /** Stößt den app-eigenen Passwort-Reset an (Einmal-Passwort oder OTP-Mail). */
    triggerPasswordReset(email: string): Promise<PasswordResetCliResult>;
    /** Deaktiviert einen User (app-spezifischer Status). */
    deactivate(email: string, reason: string): Promise<PlatformUserDto>;
}

/** Liefert aktuellen Verbrauch für eine Limit-Dimension. */
export interface QuotaProvider {
    /** quotaKey, wie via `@DefinesQuota({ key })` deklariert. */
    readonly key: string;
    count(tenantId: string): Promise<number>;
    /** Optional: Cache-TTL in Sekunden (Default 30s). */
    readonly cacheTtlSeconds?: number;
}

/** Adapter für MFA-Geheimnis-Persistenz. */
export interface MfaPort {
    /** Liefert das gespeicherte TOTP-Secret oder null. */
    getSecret(userId: string): Promise<string | null>;
    /** Persistiert oder löscht (null) das TOTP-Secret. */
    setSecret(userId: string, secret: string | null): Promise<void>;
    /** Plattform ruft das beim mfa-setup-Command auf. */
    isEnabled(userId: string): Promise<boolean>;
}

/**
 * Opaker Transaktions-Kontext. Konsument bestimmt den konkreten Typ
 * (z. B. `Prisma.TransactionClient` in AutohausPro). Plattform-Code reicht ihn
 * nur durch — kein Inhalt-Inspect.
 */
export type TransactionContext = unknown;

/**
 * Transaktions-Runner — Wrapper über `prisma.$transaction` (AutohausPro),
 * Django-`transaction.atomic` (Dagitto) etc.
 */
export interface TransactionRunner {
    run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
