// Discovery decorators for code capabilities, quotas and runtime enforcement.
//
// Four decorators:
//   - @ImplementsCapability(key, options)  — method level: Discovery marker
//   - @RequiresCapability(...keys)         — method/class level: runtime guard
//   - @DefinesQuota(options)               — class level: QuotaProvider marker
//   - @EnforceQuota(key, options)          — method level: runtime increment
//
// Pattern analogous to billing/require-feature.decorator.ts: SetMetadata from
// @nestjs/common; the Discovery scanner reads the metadata at boot time
// via Reflector + DiscoveryService.

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
 * Internal metadata shape under which `@ImplementsCapability` stores its data.
 * The scanner reads it back out.
 */
export interface ImplementsCapabilityMetadata extends ImplementsCapabilityOptions {
    capabilityKey: string;
}

/**
 * Marks a method as the implementation of a technical capability.
 *
 * The capability is the smallest checkable unit (e.g. `invoice.create`).
 * Multiple methods may declare the same capability — the
 * Discovery scanner deduplicates by `capabilityKey`.
 *
 * Optional fields:
 * - `feature` aggregates capabilities into feature wrappers that the
 *   SuperAdmin can reference in plans.
 * - `status` controls visibility/lifecycle (default `active`).
 * - `kind` declares the implementation kind (default `endpoint`).
 *
 * **Bundles are deliberately NOT declared in the decorator** (SPEC_V2 §3.1).
 * They are created exclusively in the SuperAdmin UI (DB table `bundles`),
 * by the admin grouping features there.
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
 * Runtime guard: the tenant must have **all** specified capabilities.
 * Multiple calls (or multiple keys) are evaluated as a logical AND.
 *
 * In contrast to `@RequireFeature(...)` (defined in
 * `billing/require-feature.decorator.ts`, logical OR), the capability guard
 * checks at the capability level — finer-grained, because a feature has
 * multiple capabilities.
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
 * Marks a class as a QuotaProvider for a QuotaKey. The
 * Discovery scanner aggregates from it the list of all quotas defined in
 * code; the SuperAdmin can reference these as limits in plans/bundles.
 *
 * A class may have multiple `@DefinesQuota` decorators (e.g. a
 * provider that holds counters for multiple QuotaKeys).
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
 * Internal metadata shape under which `@EnforceQuota` stores its data.
 */
export interface EnforceQuotaMetadata extends EnforceQuotaOptions {
    quotaKey: string;
}

/**
 * Runtime enforcement: checks + increments a quota counter per call.
 * The corresponding `@DefinesQuota` provider must be registered in at least
 * one class (the strict-mode check verifies this).
 *
 * Default `incrementBy: 1`, `timing: 'before'`. On quota overrun the
 * QuotaGuard throws a `LimitExceededError` (see
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
