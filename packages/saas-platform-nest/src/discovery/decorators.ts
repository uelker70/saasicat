// Discovery-Decorators für Code-Capabilities, Quotas und Runtime-Enforcement.
//
// Vier Decorators:
//   - @ImplementsCapability(key, options)  — Methoden-Level: Discovery-Marker
//   - @RequiresCapability(...keys)         — Methoden-/Klassen-Level: Runtime-Guard
//   - @DefinesQuota(options)               — Klassen-Level: QuotaProvider-Marker
//   - @EnforceQuota(key, options)          — Methoden-Level: Runtime-Increment
//
// Pattern analog zu billing/require-feature.decorator.ts: SetMetadata aus
// @nestjs/common; der Discovery-Scanner liest die Metadata zur Boot-Zeit
// via Reflector + DiscoveryService.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §3.1

import { SetMetadata } from '@nestjs/common';

import {
    DEFINES_QUOTA_KEY,
    ENFORCE_QUOTA_KEY,
    IMPLEMENTS_CAPABILITY_KEY,
    REQUIRES_CAPABILITY_KEY,
} from './tokens.js';
import type {
    DefinesQuotaOptions,
    EnforceQuotaOptions,
    ImplementsCapabilityOptions,
} from './types.js';

/**
 * Internal-Metadata-Shape, unter dem `@ImplementsCapability` die Daten ablegt.
 * Der Scanner liest das wieder aus.
 */
export interface ImplementsCapabilityMetadata extends ImplementsCapabilityOptions {
    capabilityKey: string;
}

/**
 * Markiert eine Methode als Implementierung einer technischen Capability.
 *
 * Die Capability ist die kleinste prüfbare Einheit (z. B. `invoice.create`).
 * Mehrere Methoden können dieselbe Capability deklarieren — der
 * Discovery-Scanner dedupliziert nach `capabilityKey`.
 *
 * Optionale Felder:
 * - `feature` aggregiert Capabilities zu Feature-Hüllen, die der
 *   SuperAdmin in Plans referenzieren kann.
 * - `status` steuert Sichtbarkeit/Lifecycle (default `active`).
 * - `kind` deklariert die Implementierungs-Art (default `endpoint`).
 *
 * **Bundles werden bewusst NICHT im Decorator deklariert** (SPEC_V2 §3.1).
 * Sie entstehen ausschließlich im SuperAdmin-UI (DB-Tabelle `bundles`),
 * indem der Admin Features dort gruppiert.
 *
 * @example
 * ```ts
 * @Post()
 * @ImplementsCapability('invoice.create', {
 *   label: 'Rechnung erstellen',
 *   feature: 'INVOICE_MANAGEMENT',
 *   kind: 'endpoint',
 *   owner: 'accounting',
 * })
 * createInvoice() { … }
 * ```
 */
export const ImplementsCapability = (
    capabilityKey: string,
    options: ImplementsCapabilityOptions = {},
) =>
    SetMetadata(IMPLEMENTS_CAPABILITY_KEY, {
        capabilityKey,
        ...options,
    } satisfies ImplementsCapabilityMetadata);

/**
 * Runtime-Guard: Tenant muss **alle** angegebenen Capabilities haben.
 * Mehrere Aufrufe (oder mehrere Keys) werden als Logical-AND ausgewertet.
 *
 * Im Gegensatz zu `@RequireFeature(...)` (existiert in
 * `billing/require-feature.decorator.ts`, Logical-OR) prüft Capability-Guard
 * auf Capability-Ebene — feinkörniger, weil ein Feature mehrere Capabilities
 * hat.
 *
 * @example
 * ```ts
 * @Post()
 * @ImplementsCapability('invoice.create', { … })
 * @RequiresCapability('invoice.create')
 * createInvoice() { … }
 * ```
 */
export const RequiresCapability = (...capabilityKeys: string[]) =>
    SetMetadata(REQUIRES_CAPABILITY_KEY, capabilityKeys);

/**
 * Markiert eine Klasse als QuotaProvider für einen QuotaKey. Der
 * Discovery-Scanner aggregiert daraus die Liste aller im Code definierten
 * Quotas; der SuperAdmin kann diese in Plans/Bundles als Limits
 * referenzieren.
 *
 * Eine Klasse darf mehrere `@DefinesQuota`-Decorators haben (z. B. ein
 * Provider, der Counter für mehrere QuotaKeys hält).
 *
 * @example
 * ```ts
 * @Injectable()
 * @DefinesQuota({
 *   key: 'invoicesPerMonth',
 *   label: 'Rechnungen pro Monat',
 *   unit: 'invoices',
 *   policy: 'monthlyReset',
 *   feature: 'INVOICE_MANAGEMENT',
 * })
 * class InvoiceQuotaProvider implements QuotaProvider { … }
 * ```
 */
export const DefinesQuota = (options: DefinesQuotaOptions) =>
    SetMetadata(DEFINES_QUOTA_KEY, options);

/**
 * Internal-Metadata-Shape, unter dem `@EnforceQuota` die Daten ablegt.
 */
export interface EnforceQuotaMetadata extends EnforceQuotaOptions {
    quotaKey: string;
}

/**
 * Runtime-Enforcement: prüft + inkrementiert einen Quota-Counter pro Aufruf.
 * Der zugehörige `@DefinesQuota`-Provider muss in mindestens einer Klasse
 * registriert sein (Strict-Mode-Check verifiziert das).
 *
 * Default `incrementBy: 1`, `timing: 'before'`. Bei Quota-Überschreitung
 * wirft der QuotaGuard eine `LimitExceededError` (siehe
 * `entitlement/limit-exceeded-error.ts`).
 *
 * @example
 * ```ts
 * @Post()
 * @ImplementsCapability('invoice.create', { … })
 * @EnforceQuota('invoicesPerMonth', { incrementBy: 1 })
 * createInvoice() { … }
 * ```
 */
export const EnforceQuota = (quotaKey: string, options: EnforceQuotaOptions = {}) =>
    SetMetadata(ENFORCE_QUOTA_KEY, {
        quotaKey,
        incrementBy: options.incrementBy ?? 1,
        timing: options.timing ?? 'before',
    } satisfies EnforceQuotaMetadata);
