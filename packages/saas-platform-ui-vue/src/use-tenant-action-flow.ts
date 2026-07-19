// useTenantActionFlow — wandelt `manifest.tenants.actions[]` in eine
// invoke-fähige Liste um, die Confirm-Flow + MFA-Flow + Handler-Dispatch
// in einem Aufruf orchestriert.
//
// Vorher: jede App duplizierte den Flow lokal in ihrer `TenantsPage.vue`
// (Confirm-Dialog → MFA-Dialog → fetch). Drift zwischen Manifest-Spec
// (`requiresMfa: true`) und tatsächlichem UI-Flow war unvermeidbar.
//
// Jetzt: Manifest deklariert die Action mit `requiresMfa` und `confirmType`,
// der Composable orchestriert die Reihenfolge, App liefert nur die Provider
// (Quasar-Dialog) und den Handler (HTTP-Call) — beides via
// `createSuperAdminApp({ actions: { [actionKey]: handler } })`.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §4.5 + Findings #2/#4.

import { computed, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest, TenantActionDef, TenantDto } from '@saasicat/types';
import { ActionRegistry } from './action-registry.js';
import { useSuperAdminActions } from './use-super-admin-context.js';

/**
 * Input, das der App-seitige Handler bekommt. `mfaCode` ist gefüllt,
 * wenn `def.requiresMfa === true` UND der Provider einen Code liefert.
 * `reason` kommt aus dem Confirm-Provider (typed-slug / typed-production
 * confirms typischerweise eine Slug-Eingabe als Sicherheitsabfrage).
 */
export interface TenantActionInput<TRow extends TenantDto = TenantDto> {
    row: TRow;
    mfaCode: string | null;
    reason: string | null;
    /**
     * App-spezifische Zusatz-Inputs, die der Confirm-Provider erfasst und
     * an den Handler durchreicht (z. B. `until` für `pilots.extend` bei
     * `confirmType: 'date'`). Liegt der Confirm-Provider keine `extras`
     * an, ist es ein leeres Objekt.
     */
    extras: Record<string, unknown>;
}

/** Provider-Contract für UI-Dialoge — Apps liefern Quasar-/Headless-Implementierung. */
export interface TenantActionFlowProviders<TRow extends TenantDto = TenantDto> {
    /**
     * App-spezifische Confirm-UI. Wird aufgerufen, wenn `def.confirmType !==
     * 'none'`. Returnt `{ ok: false }` wenn der User abbricht. Optional
     * darf `extras` zurückgegeben werden — das landet im
     * `TenantActionInput.extras` des Handlers (z. B. `{ until: ISO }` für
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
     * App-spezifische MFA-UI. Wird aufgerufen, wenn `def.requiresMfa`. Returnt
     * `null` wenn der User abbricht. Sonst der TOTP-Code, der dem Backend
     * via `X-Mfa-Code`-Header beigegeben werden muss.
     */
    mfa?: (def: TenantActionDef, ctx: { row: TRow }) => Promise<string | null>;
    /** Optional: Erfolgs-/Fehler-Notify (Toast/Snackbar). */
    notify?: (kind: 'positive' | 'negative', message: string) => void;
    /** Optional: Hook nach erfolgreichem Dispatch (z. B. Liste reloaden). */
    onSuccess?: (def: TenantActionDef, ctx: { row: TRow }) => void;
    /**
     * Optional: Row-spezifische Sichtbarkeit. Wird nach Capability- und
     * Handler-Check ausgewertet — `false` blendet die Action für diese Row
     * aus (z. B. `tenants.suspend` nur für aktive Tenants).
     * Default: `true` (nicht ausblenden).
     */
    visibleForRow?: (def: TenantActionDef, row: TRow) => boolean;
}

export interface ResolvedTenantAction<TRow extends TenantDto = TenantDto> {
    def: TenantActionDef;
    /**
     * Startet den Flow: Confirm → MFA → Handler. Returnt das Handler-Result
     * oder `undefined`, wenn der Flow vom User abgebrochen wurde.
     */
    invoke: (row: TRow) => Promise<unknown>;
}

export interface UseTenantActionFlowResult<TRow extends TenantDto = TenantDto> {
    registry: ComputedRef<ActionRegistry | null>;
    /**
     * Row-unabhängige Action-Liste, gefiltert nach **statischen** Kriterien:
     *   1. Capability-Gate: `requiredCapability` darf im Manifest nicht
     *      explizit `false` sein.
     *   2. Handler-Gate: für jeden `actionKey` muss ein Handler in der
     *      `actions:`-Map registriert sein (sonst Ghost-Button).
     *
     * `visibleForRow` wird hier NICHT ausgewertet — die Liste ist die
     * Basis, aus der Pages ihre Action-Deskriptoren ableiten. Die row-
     * spezifische Sichtbarkeit kommt erst über `actionsForRow(row)` oder
     * über die `condition()` der Plattform-Page-Buttons.
     *
     * Damit funktionieren Sample-Row-basierte UI-Konstruktionen wieder:
     * eine Page kann `availableActions.value` durchgehen und Buttons
     * vorbereiten, ohne dass `tenants.reactivate` für `isActive: true`
     * Sample-Rows verschwindet.
     */
    availableActions: ComputedRef<TenantActionDef[]>;
    /**
     * Liefert die für `row` sichtbaren Actions. Filtert zusätzlich zu den
     * Capability-/Handler-Checks (siehe `availableActions`) den
     * `visibleForRow`-Provider durch — also alles, was row-spezifisch
     * abhängt (Bsp. `tenants.suspend` nur für aktive Tenants).
     */
    actionsForRow: (row: TRow) => ResolvedTenantAction<TRow>[];
    /** Drift-Diagnose: deklarierte Actions ohne registrierten Handler. */
    orphanedDefs: ComputedRef<string[]>;
}

/**
 * Vue-Composable. Nutzt:
 *   1. `useSuperAdminActions()` als Quelle der Handler-Map (App liefert sie
 *      via `createSuperAdminApp({ actions: { [actionKey]: handler } })`).
 *   2. Den übergebenen Manifest-Ref, um auf Manifest-Reload zu reagieren.
 *
 * Liefert eine `actionsForRow(row)`-Funktion, die in der Page direkt in
 * `<button v-for="...">` gerendert wird. Der `invoke`-Aufruf orchestriert
 * Confirm + MFA + Dispatch automatisch.
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
    // Capability-Gate: Apps können Actions deaktivieren, indem sie die
    // requiredCapability im Manifest explizit auf `false` setzen. Fehlt der
    // Eintrag (undefined), gilt die Action als verfügbar — die Plattform
    // verlangt nicht, dass jede Capability deklariert sein muss.
    if (def.requiredCapability && capabilities[def.requiredCapability] === false) {
        return false;
    }
    // Handler-Gate: ohne registrierten Handler entsteht ein Ghost-Button,
    // der erst nach Confirm/MFA fehlschlägt. Wir blenden ihn lieber sofort
    // aus; `orphanedDefs` macht die Drift weiterhin diagnostizierbar.
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
        // MissingHandlerError oder ActionDefNotInManifestError — App-Setup-Fehler.
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
