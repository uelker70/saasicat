// usePlatformTenantActions — kapselt die Orchestrierung, die vorher in
// jedem App-Wrapper (vereinsfux/TenantsPage.vue + autohauspro/AdminTenantsPage.vue)
// dupliziert wurde:
//   - MFA-Dialog-State + Promise-Resolver (Quasar-Dialog × Promise-Flow)
//   - Confirm-Dialog-State + Promise-Resolver
//   - `useTenantActionFlow`-Wiring (confirm/mfa/notify/onSuccess Providers)
//   - Manifest → `TenantRowAction`-Mapping (icon/tone + condition/handler)
//   - Drift-Diagnose (`realOrphans` mit Capability-Filter)
//
// Wird intern von `pages-standard/TenantsPage.vue` benutzt, wenn die App
// einen `manifest`-Prop liefert. Apps müssen das State-Boilerplate dann
// nicht mehr selbst aufsetzen.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest, TenantActionDef, TenantDto } from '@saasicat/types';
import { useTenantActionFlow } from './use-tenant-action-flow.js';

export type TenantRowLike = TenantDto & Record<string, unknown>;

export interface PlatformTenantActionTone {
    tone: 'positive' | 'negative' | 'primary' | 'warning' | 'accent';
}

export interface PlatformTenantActionRow<TRow extends TenantRowLike> {
    id: string;
    label: string;
    icon: string;
    tone: PlatformTenantActionTone['tone'];
    actionKey: string;
    condition: (row: TRow) => boolean;
    handler: (row: TRow) => void;
}

export interface PlatformTenantActionsOptions<TRow extends TenantRowLike> {
    /** Reaktive Manifest-Quelle — i. d. R. `storeToRefs(useManifestStore()).manifest`. */
    manifest: Ref<AdminManifest | null>;
    /** Notify-Provider (Toast/Snackbar). */
    notify: (kind: 'positive' | 'negative', message: string) => void;
    /** Success-Hook nach erfolgreichem Dispatch (z. B. Liste reloaden). */
    onSuccess: () => Promise<void> | void;
    /** Row-spezifische Sichtbarkeit. Default: suspend nur für aktive, reactivate nur für inaktive Tenants. */
    visibleForRow?: (def: TenantActionDef, row: TRow) => boolean;
    /** MFA-Dialog-Beschreibung. Default: `"{def.label} — Tenant „{row.name}". TOTP-Code aus Authenticator eingeben."`. */
    mfaDescription?: (def: TenantActionDef, row: TRow) => string;
    /** Manifest-Action → Icon. Default: suspend→block, reactivate→play_arrow, grant→star, revoke→star_outline, impersonate→switch_account, export→download, sonst→bolt. */
    iconForActionKey?: (actionKey: string) => string;
    /** Manifest-Action → Tone. Default: suspend/revoke→negative, reactivate/grant→positive, sonst→primary. */
    toneForActionKey?: (actionKey: string) => PlatformTenantActionTone['tone'];
}

type ConfirmResult = {
    ok: boolean;
    reason?: string | null;
    extras?: Record<string, unknown>;
};

export interface MfaDialogState {
    show: boolean;
    description: string;
    error: string;
}

export interface ConfirmDialogState<TRow extends TenantRowLike> {
    show: boolean;
    def: TenantActionDef | null;
    row: TRow | null;
}

export interface PlatformTenantActionsResult<TRow extends TenantRowLike> {
    /** Reaktive Liste fertig konfigurierter Row-Actions — direkt an die Page-Action-Renderer reichen. */
    manifestActions: ComputedRef<PlatformTenantActionRow<TRow>[]>;
    /** Manifest-Drift: deklarierte Actions ohne Handler (Capability=false rausgefiltert). */
    realOrphans: ComputedRef<string[]>;
    // MFA-Dialog-State + Handler — direkt an `<MfaPromptDialog>` binden.
    mfa: Ref<MfaDialogState>;
    onMfaConfirm: (code: string) => void;
    onMfaDialogVisibility: (open: boolean) => void;
    // Confirm-Dialog-State + Handler — direkt an `<TenantActionConfirmDialog>` binden.
    confirmDialog: Ref<ConfirmDialogState<TRow>>;
    onConfirmSubmit: (payload: { reason: string | null; extras?: Record<string, unknown> }) => void;
    onConfirmCancel: () => void;
    onConfirmDialogVisibility: (open: boolean) => void;
}

const DEFAULT_VISIBLE_FOR_ROW = <TRow extends TenantRowLike>(
    def: TenantActionDef,
    row: TRow,
): boolean => {
    if (def.actionKey === 'tenants.suspend') return row.isActive;
    if (def.actionKey === 'tenants.reactivate') return !row.isActive;
    return true;
};

const DEFAULT_MFA_DESCRIPTION = <TRow extends TenantRowLike>(
    def: TenantActionDef,
    row: TRow,
): string => `${def.label} — Tenant „${row.name}". TOTP-Code aus Authenticator eingeben.`;

const DEFAULT_ICON_FOR_ACTION_KEY = (actionKey: string): string => {
    if (actionKey.endsWith('.suspend')) return 'block';
    if (actionKey.endsWith('.reactivate')) return 'play_arrow';
    if (actionKey.endsWith('.grant')) return 'star';
    if (actionKey.endsWith('.revoke')) return 'star_outline';
    if (actionKey.endsWith('.impersonate')) return 'switch_account';
    if (actionKey.endsWith('.export')) return 'download';
    return 'bolt';
};

const DEFAULT_TONE_FOR_ACTION_KEY = (actionKey: string): PlatformTenantActionTone['tone'] => {
    if (actionKey.endsWith('.suspend') || actionKey.endsWith('.revoke')) return 'negative';
    if (actionKey.endsWith('.reactivate') || actionKey.endsWith('.grant')) return 'positive';
    return 'primary';
};

/**
 * Default-Helper für Apps, die `iconForActionKey` selbst überschreiben
 * wollen, aber als Fallback die Plattform-Defaults nutzen wollen.
 */
export function defaultIconForActionKey(actionKey: string): string {
    return DEFAULT_ICON_FOR_ACTION_KEY(actionKey);
}

/**
 * Default-Helper für Apps, die `toneForActionKey` selbst überschreiben
 * wollen, aber als Fallback die Plattform-Defaults nutzen wollen.
 */
export function defaultToneForActionKey(actionKey: string): PlatformTenantActionTone['tone'] {
    return DEFAULT_TONE_FOR_ACTION_KEY(actionKey);
}

export function usePlatformTenantActions<TRow extends TenantRowLike>(
    options: PlatformTenantActionsOptions<TRow>,
): PlatformTenantActionsResult<TRow> {
    const mfaDescription = options.mfaDescription ?? DEFAULT_MFA_DESCRIPTION;
    const iconForActionKey = options.iconForActionKey ?? DEFAULT_ICON_FOR_ACTION_KEY;
    const toneForActionKey = options.toneForActionKey ?? DEFAULT_TONE_FOR_ACTION_KEY;
    const visibleForRow = options.visibleForRow ?? DEFAULT_VISIBLE_FOR_ROW;

    // ── MFA-Dialog-State + Resolver ───────────────────────────────────
    // Der `mfa`-Provider unten setzt `pendingMfaResolve` und wartet, bis
    // `onMfaConfirm` (Submit) oder Abbruch (Update v-model auf false) ihn
    // auflöst. Damit verschmilzt das deklarative Quasar-Dialog mit dem
    // promise-basierten Action-Flow.
    const mfa = ref<MfaDialogState>({ show: false, description: '', error: '' });
    let pendingMfaResolve: ((code: string | null) => void) | null = null;

    function showMfaDialog(def: TenantActionDef, ctx: { row: TRow }): Promise<string | null> {
        return new Promise((resolve) => {
            mfa.value = {
                show: true,
                description: mfaDescription(def, ctx.row),
                error: '',
            };
            pendingMfaResolve = (code) => {
                pendingMfaResolve = null;
                resolve(code);
            };
        });
    }

    function onMfaConfirm(code: string): void {
        pendingMfaResolve?.(code);
        mfa.value.show = false;
    }

    // Dialog kann auch über v-close-popup (Abbrechen-Button), ESC oder
    // Backdrop-Klick geschlossen werden — in dem Fall feuert nur
    // `update:modelValue=false`, kein `@confirm`. Ohne diesen Handler würde
    // der Action-Flow-Promise hängen.
    function onMfaDialogVisibility(open: boolean): void {
        mfa.value.show = open;
        if (!open && pendingMfaResolve) {
            pendingMfaResolve(null);
        }
    }

    // ── Confirm-Dialog-State + Resolver ───────────────────────────────
    const confirmDialog = ref<ConfirmDialogState<TRow>>({
        show: false,
        def: null,
        row: null,
    }) as Ref<ConfirmDialogState<TRow>>;
    let pendingConfirmResolve: ((result: ConfirmResult) => void) | null = null;

    function showConfirmDialog(def: TenantActionDef, ctx: { row: TRow }): Promise<ConfirmResult> {
        return new Promise((resolve) => {
            confirmDialog.value = { show: true, def, row: ctx.row };
            pendingConfirmResolve = (result) => {
                pendingConfirmResolve = null;
                resolve(result);
            };
        });
    }

    function onConfirmSubmit(payload: {
        reason: string | null;
        extras?: Record<string, unknown>;
    }): void {
        pendingConfirmResolve?.({
            ok: true,
            reason: payload.reason,
            extras: payload.extras,
        });
        confirmDialog.value.show = false;
    }

    function onConfirmCancel(): void {
        pendingConfirmResolve?.({ ok: false });
        confirmDialog.value.show = false;
    }

    function onConfirmDialogVisibility(open: boolean): void {
        confirmDialog.value.show = open;
        if (!open && pendingConfirmResolve) {
            pendingConfirmResolve({ ok: false });
        }
    }

    // ── Flow ──────────────────────────────────────────────────────────
    const flow = useTenantActionFlow<TRow>(options.manifest, {
        confirm: showConfirmDialog,
        mfa: showMfaDialog,
        notify: options.notify,
        onSuccess: () => {
            void options.onSuccess();
        },
        visibleForRow,
    });

    // ── Manifest → TenantRowAction mapping ────────────────────────────
    // `availableActions` ist row-unabhängig (Capability + Handler-Existenz)
    // — die row-spezifische Sichtbarkeit kommt über `condition()` +
    // `actionsForRow(row)`. Damit erscheint z. B. `tenants.reactivate`
    // für inaktive Tenants, obwohl bei der Initial-Berechnung keine
    // echte Row vorliegt.
    const manifestActions = computed<PlatformTenantActionRow<TRow>[]>(() =>
        flow.availableActions.value.map((def) => ({
            id: def.id,
            label: def.label,
            icon: iconForActionKey(def.actionKey),
            tone: toneForActionKey(def.actionKey),
            actionKey: def.actionKey,
            condition: (row: TRow) =>
                flow.actionsForRow(row).some((a) => a.def.actionKey === def.actionKey),
            handler: (row: TRow) => {
                const resolved = flow
                    .actionsForRow(row)
                    .find((a) => a.def.actionKey === def.actionKey);
                // Kann nur passieren, wenn die Sichtbarkeit zwischen
                // condition() und handler() gewechselt hat (z. B. paralleler
                // Reload). Dann bricht der Composable den Flow sauber ab.
                void resolved?.invoke(row);
            },
        })),
    );

    // ── Drift-Diagnose ────────────────────────────────────────────────
    // Wir filtern Orphans, deren `requiredCapability` im Manifest auf
    // `false` gesetzt ist, raus: Plattform-Core deklariert z. B.
    // `tenants.impersonate` und `subscriptions.cancel`, die manche Apps
    // bewusst nicht implementieren (Capability=false, Button bleibt
    // ausgeblendet). Sie sind kein Drift, sondern absichtliche Nicht-
    // Implementierung — nicht warnen.
    const realOrphans = computed<string[]>(() => {
        const caps = options.manifest.value?.capabilities ?? {};
        const defs = options.manifest.value?.tenants?.actions ?? [];
        const defByActionKey = new Map(defs.map((d) => [d.actionKey, d]));
        return flow.orphanedDefs.value.filter((actionKey) => {
            const def = defByActionKey.get(actionKey);
            const requiredCap = def?.requiredCapability;
            if (!requiredCap) return true;
            return caps[requiredCap] === true;
        });
    });

    return {
        manifestActions,
        realOrphans,
        mfa,
        onMfaConfirm,
        onMfaDialogVisibility,
        confirmDialog,
        onConfirmSubmit,
        onConfirmCancel,
        onConfirmDialogVisibility,
    };
}
