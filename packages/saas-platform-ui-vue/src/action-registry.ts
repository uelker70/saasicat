// ActionRegistry — Central Dispatch für `TenantActionDef`-deklarierte
// Operationen.
//
// Konsumenten-Shell registriert eine `actions:`-Map mit
// `actionKey → ActionHandler`-Bindings. Wenn die Manifest-Action z. B.
// `actionKey: 'TENANT_SUSPEND'` deklariert, muss die Shell einen Handler
// unter dem gleichen Key bereitstellen — sonst wirft `dispatch` einen
// `MissingHandlerError` mit klarer Diagnose.
//
// MFA-Prompt + Confirm-Modal bleiben Konsumenten-spezifisch (Quasar-Dialog,
// Headless-UI etc.); die Registry liefert nur das Action-Definition-Paar
// `{def, handler}`, damit die Shell-UI-Schicht den passenden Vor-Flow
// auslösen kann.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.6 (4.5).

import type { AdminManifest, TenantActionDef } from '@saasicat/types';

/** Konsument-Implementation; bekommt die Action-Inputs als generisches Object. */
export type ActionHandler<TInput = unknown, TResult = unknown> = (
    input: TInput,
) => Promise<TResult>;

export interface ResolvedAction<TInput = unknown, TResult = unknown> {
    def: TenantActionDef;
    handler: ActionHandler<TInput, TResult>;
}

export class MissingHandlerError extends Error {
    constructor(actionKey: string) {
        super(
            `Kein Handler für actionKey "${actionKey}" registriert. ` +
                `Konsument-Shell muss \`actions["${actionKey}"]\` bereitstellen.`,
        );
        this.name = 'MissingHandlerError';
    }
}

export class ActionDefNotInManifestError extends Error {
    constructor(actionKey: string) {
        super(
            `actionKey "${actionKey}" ist im Manifest nicht deklariert. ` +
                `Bitte als TenantAction in einer ManifestContribution registrieren.`,
        );
        this.name = 'ActionDefNotInManifestError';
    }
}

export class ActionRegistry {
    private readonly defs: Map<string, TenantActionDef> = new Map();
    private readonly handlers: Map<string, ActionHandler> = new Map();

    constructor(manifest: AdminManifest, handlers: Record<string, ActionHandler> = {}) {
        for (const def of manifest.tenants?.actions ?? []) {
            this.defs.set(def.actionKey, def);
        }
        for (const [key, handler] of Object.entries(handlers)) {
            this.handlers.set(key, handler);
        }
    }

    /**
     * Registriert einen Handler nachträglich (z. B. wenn Konsumenten-Code
     * lazy lädt). Wirft `ActionDefNotInManifestError`, wenn der `actionKey`
     * nicht im Manifest deklariert ist — verhindert tote Registrierungen.
     */
    register<TInput, TResult>(actionKey: string, handler: ActionHandler<TInput, TResult>): void {
        if (!this.defs.has(actionKey)) {
            throw new ActionDefNotInManifestError(actionKey);
        }
        this.handlers.set(actionKey, handler as ActionHandler);
    }

    /**
     * Gibt das `{def, handler}`-Paar zurück. Wirft, wenn der Key im
     * Manifest fehlt oder kein Handler registriert ist. UI-Schicht der
     * Shell ruft die Methode, prüft `def.requiresMfa` / `def.confirmType`
     * für Vor-Flow und ruft dann `handler(input)`.
     */
    get<TInput = unknown, TResult = unknown>(actionKey: string): ResolvedAction<TInput, TResult> {
        const def = this.defs.get(actionKey);
        if (!def) throw new ActionDefNotInManifestError(actionKey);
        const handler = this.handlers.get(actionKey);
        if (!handler) throw new MissingHandlerError(actionKey);
        return { def, handler: handler as ActionHandler<TInput, TResult> };
    }

    /**
     * Convenience: `get(key).handler(input)`. UI-Konvenienz für Aktionen,
     * die weder MFA noch Confirm brauchen.
     */
    async dispatch<TInput, TResult>(actionKey: string, input: TInput): Promise<TResult> {
        return this.get<TInput, TResult>(actionKey).handler(input);
    }

    /**
     * Liste der actionKeys, die im Manifest deklariert sind, aber keinen
     * Handler haben. Konsumenten nutzen das in einem Doctor-Check, um
     * Drift zwischen Manifest und Shell-Build zu erkennen.
     */
    listOrphanedDefs(): string[] {
        return [...this.defs.keys()].filter((k) => !this.handlers.has(k));
    }

    /**
     * Liste der registrierten Handler, die im Manifest fehlen. Drift in
     * die andere Richtung.
     */
    listOrphanedHandlers(): string[] {
        return [...this.handlers.keys()].filter((k) => !this.defs.has(k));
    }
}
