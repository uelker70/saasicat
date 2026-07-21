// usePlatformTenantActions — encapsulates the orchestration that was
// previously duplicated in every app wrapper (the tenants pages of the
// consumer admins):
//   - MFA dialog state + promise resolver (Quasar dialog × promise flow)
//   - Confirm dialog state + promise resolver
//   - `useTenantActionFlow` wiring (confirm/mfa/notify/onSuccess providers)
//   - Manifest → `TenantRowAction` mapping (icon/tone + condition/handler)
//   - Drift diagnosis (`realOrphans` with capability filter)
//
// Used internally by `pages-standard/TenantsPage.vue` when the app
// provides a `manifest` prop. Apps then no longer have to set up the
// state boilerplate themselves.

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
    /** Reactive manifest source — usually `storeToRefs(useManifestStore()).manifest`. */
    manifest: Ref<AdminManifest | null>;
    /** Notify provider (toast/snackbar). */
    notify: (kind: 'positive' | 'negative', message: string) => void;
    /** Success hook after a successful dispatch (e.g. reload the list). */
    onSuccess: () => Promise<void> | void;
    /** Row-specific visibility. Default: suspend only for active, reactivate only for inactive tenants. */
    visibleForRow?: (def: TenantActionDef, row: TRow) => boolean;
    /** MFA dialog description. Default: `"{def.label} — Tenant „{row.name}". TOTP-Code aus Authenticator eingeben."`. */
    mfaDescription?: (def: TenantActionDef, row: TRow) => string;
    /** Manifest action → icon. Default: suspend→block, reactivate→play_arrow, grant→star, revoke→star_outline, impersonate→switch_account, export→download, otherwise→bolt. */
    iconForActionKey?: (actionKey: string) => string;
    /** Manifest action → tone. Default: suspend/revoke→negative, reactivate/grant→positive, otherwise→primary. */
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
    /** Reactive list of fully configured row actions — pass straight to the page action renderer. */
    manifestActions: ComputedRef<PlatformTenantActionRow<TRow>[]>;
    /** Manifest drift: declared actions without a handler (Capability=false filtered out). */
    realOrphans: ComputedRef<string[]>;
    // MFA dialog state + handler — bind directly to `<MfaPromptDialog>`.
    mfa: Ref<MfaDialogState>;
    onMfaConfirm: (code: string) => void;
    onMfaDialogVisibility: (open: boolean) => void;
    // Confirm dialog state + handler — bind directly to `<TenantActionConfirmDialog>`.
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
 * Default helper for apps that want to override `iconForActionKey`
 * themselves but use the platform defaults as a fallback.
 */
export function defaultIconForActionKey(actionKey: string): string {
    return DEFAULT_ICON_FOR_ACTION_KEY(actionKey);
}

/**
 * Default helper for apps that want to override `toneForActionKey`
 * themselves but use the platform defaults as a fallback.
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

    // ── MFA dialog state + resolver ───────────────────────────────────
    // The `mfa` provider below sets `pendingMfaResolve` and waits until
    // `onMfaConfirm` (submit) or cancellation (updating v-model to false)
    // resolves it. This merges the declarative Quasar dialog with the
    // promise-based action flow.
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

    // The dialog can also be closed via v-close-popup (cancel button), ESC
    // or a backdrop click — in that case only `update:modelValue=false`
    // fires, not `@confirm`. Without this handler the action-flow promise
    // would hang.
    function onMfaDialogVisibility(open: boolean): void {
        mfa.value.show = open;
        if (!open && pendingMfaResolve) {
            pendingMfaResolve(null);
        }
    }

    // ── Confirm dialog state + resolver ───────────────────────────────
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
    // `availableActions` is row-independent (capability + handler existence)
    // — the row-specific visibility comes via `condition()` +
    // `actionsForRow(row)`. This is why e.g. `tenants.reactivate` appears
    // for inactive tenants even though no real row is available during the
    // initial computation.
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
                // Can only happen if the visibility changed between
                // condition() and handler() (e.g. a parallel reload). In
                // that case the composable aborts the flow cleanly.
                void resolved?.invoke(row);
            },
        })),
    );

    // ── Drift diagnosis ───────────────────────────────────────────────
    // We filter out orphans whose `requiredCapability` is set to `false`
    // in the manifest: platform core declares e.g. `tenants.impersonate`
    // and `subscriptions.cancel`, which some apps deliberately do not
    // implement (Capability=false, the button stays hidden). These are
    // not drift but intentional non-implementation — do not warn.
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
