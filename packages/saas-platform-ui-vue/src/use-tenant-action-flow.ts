// useTenantActionFlow — turns `manifest.tenants.actions[]` into an
// invoke-capable list that orchestrates the confirm flow + MFA flow +
// handler dispatch in a single call.
//
// Before: every app duplicated the flow locally in its `TenantsPage.vue`
// (confirm dialog → MFA dialog → fetch). Drift between the manifest spec
// (`requiresMfa: true`) and the actual UI flow was unavoidable.
//
// Now: the manifest declares the action with `requiresMfa` and `confirmType`,
// the composable orchestrates the order, and the app only supplies the
// providers (Quasar dialog) and the handler (HTTP call) — both via
// `createSuperAdminApp({ actions: { [actionKey]: handler } })`.

import { computed, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest, TenantActionDef, TenantDto } from '@saasicat/types';
import { ActionRegistry } from './action-registry.js';
import { useSuperAdminActions } from './use-super-admin-context.js';

/**
 * Input the app-side handler receives. `mfaCode` is populated when
 * `def.requiresMfa === true` AND the provider supplies a code.
 * `reason` comes from the confirm provider (typed-slug / typed-production
 * typically confirm a slug entry as a safety check).
 */
export interface TenantActionInput<TRow extends TenantDto = TenantDto> {
    row: TRow;
    mfaCode: string | null;
    reason: string | null;
    /**
     * App-specific extra inputs that the confirm provider captures and
     * passes through to the handler (e.g. `until` for `pilots.extend` with
     * `confirmType: 'date'`). If the confirm provider supplies no `extras`,
     * this is an empty object.
     */
    extras: Record<string, unknown>;
}

/** Provider contract for UI dialogs — apps supply the Quasar/headless implementation. */
export interface TenantActionFlowProviders<TRow extends TenantDto = TenantDto> {
    /**
     * App-specific confirm UI. Invoked when `def.confirmType !== 'none'`.
     * Returns `{ ok: false }` when the user cancels. Optionally `extras`
     * may be returned — that ends up in the handler's
     * `TenantActionInput.extras` (e.g. `{ until: ISO }` for
     * `confirmType: 'date'`).
     */
    confirm?: (
        def: TenantActionDef,
        ctx: { row: TRow },
    ) => Promise<{
        ok: boolean;
        reason?: string | null;
        extras?: Record<string, unknown>;
    }>;
    /**
     * App-specific MFA UI. Invoked when `def.requiresMfa`. Returns `null`
     * when the user cancels. Otherwise the TOTP code that must be attached
     * to the backend via the `X-Mfa-Code` header.
     */
    mfa?: (def: TenantActionDef, ctx: { row: TRow }) => Promise<string | null>;
    /** Optional: success/error notify (toast/snackbar). */
    notify?: (kind: 'positive' | 'negative', message: string) => void;
    /** Optional: hook after a successful dispatch (e.g. reload the list). */
    onSuccess?: (def: TenantActionDef, ctx: { row: TRow }) => void;
    /**
     * Optional: row-specific visibility. Evaluated after the capability and
     * handler checks — `false` hides the action for this row (e.g.
     * `tenants.suspend` only for active tenants).
     * Default: `true` (do not hide).
     */
    visibleForRow?: (def: TenantActionDef, row: TRow) => boolean;
}

export interface ResolvedTenantAction<TRow extends TenantDto = TenantDto> {
    def: TenantActionDef;
    /**
     * Starts the flow: confirm → MFA → handler. Returns the handler result
     * or `undefined` when the user cancelled the flow.
     */
    invoke: (row: TRow) => Promise<unknown>;
}

export interface UseTenantActionFlowResult<TRow extends TenantDto = TenantDto> {
    registry: ComputedRef<ActionRegistry | null>;
    /**
     * Row-independent action list, filtered by **static** criteria:
     *   1. Capability gate: `requiredCapability` must not be explicitly
     *      `false` in the manifest.
     *   2. Handler gate: for every `actionKey` a handler must be registered
     *      in the `actions:` map (otherwise a ghost button).
     *
     * `visibleForRow` is NOT evaluated here — the list is the basis from
     * which pages derive their action descriptors. Row-specific visibility
     * only comes in via `actionsForRow(row)` or via the `condition()` of the
     * platform page buttons.
     *
     * This makes sample-row-based UI constructions work again: a page can
     * walk `availableActions.value` and prepare buttons without
     * `tenants.reactivate` disappearing for `isActive: true` sample rows.
     */
    availableActions: ComputedRef<TenantActionDef[]>;
    /**
     * Returns the actions visible for `row`. In addition to the
     * capability/handler checks (see `availableActions`), it runs the
     * `visibleForRow` provider — i.e. everything that depends on the row
     * (e.g. `tenants.suspend` only for active tenants).
     */
    actionsForRow: (row: TRow) => ResolvedTenantAction<TRow>[];
    /** Drift diagnostics: declared actions without a registered handler. */
    orphanedDefs: ComputedRef<string[]>;
}

/**
 * Vue composable. Uses:
 *   1. `useSuperAdminActions()` as the source of the handler map (the app
 *      supplies it via `createSuperAdminApp({ actions: { [actionKey]: handler } })`).
 *   2. The provided manifest ref, to react to manifest reloads.
 *
 * Returns an `actionsForRow(row)` function that is rendered directly in the
 * page inside `<button v-for="...">`. The `invoke` call orchestrates
 * confirm + MFA + dispatch automatically.
 */
export function useTenantActionFlow<TRow extends TenantDto = TenantDto>(
    manifest: Ref<AdminManifest | null>,
    providers: TenantActionFlowProviders<TRow> = {},
): UseTenantActionFlowResult<TRow> {
    const handlers = useSuperAdminActions();
    const registry = computed<ActionRegistry | null>(() => {
        if (!manifest.value) return null;
        return new ActionRegistry(manifest.value, handlers);
    });

    const orphanedDefs = computed<string[]>(() =>
        registry.value ? registry.value.listOrphanedDefs() : [],
    );

    const availableActions = computed<TenantActionDef[]>(() => {
        const m = manifest.value;
        const reg = registry.value;
        if (!m || !reg) return [];
        const defs = m.tenants?.actions ?? [];
        const caps = m.capabilities ?? {};
        const orphans = new Set(reg.listOrphanedDefs());
        return defs.filter((def) => passesStaticGates(def, caps, orphans));
    });

    function actionsForRow(row: TRow): ResolvedTenantAction<TRow>[] {
        const reg = registry.value;
        if (!reg) return [];
        return availableActions.value
            .filter((def) => !providers.visibleForRow || providers.visibleForRow(def, row))
            .map((def) => ({
                def,
                invoke: (r: TRow) => runFlow(def, r ?? row, reg, providers),
            }));
    }

    return { registry, availableActions, actionsForRow, orphanedDefs };
}

function passesStaticGates(
    def: TenantActionDef,
    capabilities: Record<string, boolean>,
    orphanedKeys: Set<string>,
): boolean {
    // Capability gate: apps can disable actions by setting the
    // requiredCapability explicitly to `false` in the manifest. If the entry
    // is missing (undefined), the action counts as available — the platform
    // does not require every capability to be declared.
    if (def.requiredCapability && capabilities[def.requiredCapability] === false) {
        return false;
    }
    // Handler gate: without a registered handler a ghost button appears that
    // only fails after confirm/MFA. We prefer to hide it immediately;
    // `orphanedDefs` keeps the drift diagnosable.
    if (orphanedKeys.has(def.actionKey)) {
        return false;
    }
    return true;
}

async function runFlow<TRow extends TenantDto>(
    def: TenantActionDef,
    row: TRow,
    registry: ActionRegistry,
    providers: TenantActionFlowProviders<TRow>,
): Promise<unknown> {
    let reason: string | null = null;
    let extras: Record<string, unknown> = {};

    if (def.confirmType && def.confirmType !== 'none') {
        if (!providers.confirm) {
            throw new Error(
                `useTenantActionFlow: Action "${def.id}" verlangt confirmType="${def.confirmType}", ` +
                    `aber kein \`confirm\`-Provider übergeben.`,
            );
        }
        const c = await providers.confirm(def, { row });
        if (!c.ok) return undefined;
        reason = c.reason ?? null;
        if (c.extras) extras = c.extras;
    }

    let mfaCode: string | null = null;
    if (def.requiresMfa) {
        if (!providers.mfa) {
            throw new Error(
                `useTenantActionFlow: Action "${def.id}" verlangt MFA, aber kein ` +
                    `\`mfa\`-Provider übergeben.`,
            );
        }
        mfaCode = await providers.mfa(def, { row });
        if (mfaCode === null) return undefined;
    }

    let resolved;
    try {
        resolved = registry.get(def.actionKey);
    } catch (err) {
        // MissingHandlerError or ActionDefNotInManifestError — app setup error.
        providers.notify?.('negative', err instanceof Error ? err.message : String(err));
        throw err;
    }

    try {
        const input: TenantActionInput<TRow> = { row, mfaCode, reason, extras };
        const result = await resolved.handler(input);
        providers.notify?.('positive', `${def.label}: erfolgreich.`);
        providers.onSuccess?.(def, { row });
        return result;
    } catch (err) {
        const message =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            (err instanceof Error ? err.message : String(err));
        providers.notify?.('negative', message);
        throw err;
    }
}
