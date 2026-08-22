// ActionRegistry — central dispatch for `TenantActionDef`-declared
// operations.
//
// The consumer shell registers an `actions:` map with
// `actionKey → ActionHandler` bindings. When the manifest action declares
// e.g. `actionKey: 'TENANT_SUSPEND'`, the shell must provide a handler under
// the same key — otherwise `dispatch` throws a `MissingHandlerError` with a
// clear diagnostic.
//
// MFA prompt + confirm modal stay consumer-specific (Quasar dialog,
// headless UI etc.); the registry only supplies the action-definition pair
// `{def, handler}` so the shell UI layer can trigger the appropriate
// pre-flow.

import type { AdminManifest, TenantActionDef } from '@saasicat/types';

/** Consumer implementation; receives the action inputs as a generic object. */
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
            `No handler registered for actionKey "${actionKey}". ` +
                `The consumer shell must provide \`actions["${actionKey}"]\`.`,
        );
        this.name = 'MissingHandlerError';
    }
}

export class ActionDefNotInManifestError extends Error {
    constructor(actionKey: string) {
        super(
            `actionKey "${actionKey}" is not declared in the manifest. ` +
                `Register it as a TenantAction in a ManifestContribution.`,
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
     * Registers a handler after the fact (e.g. when consumer code loads
     * lazily). Throws `ActionDefNotInManifestError` if the `actionKey` is not
     * declared in the manifest — prevents dead registrations.
     */
    register<TInput, TResult>(actionKey: string, handler: ActionHandler<TInput, TResult>): void {
        if (!this.defs.has(actionKey)) {
            throw new ActionDefNotInManifestError(actionKey);
        }
        this.handlers.set(actionKey, handler as ActionHandler);
    }

    /**
     * Returns the `{def, handler}` pair. Throws if the key is missing from
     * the manifest or no handler is registered. The shell's UI layer calls
     * the method, checks `def.requiresMfa` / `def.confirmType` for the
     * pre-flow, and then calls `handler(input)`.
     */
    get<TInput = unknown, TResult = unknown>(actionKey: string): ResolvedAction<TInput, TResult> {
        const def = this.defs.get(actionKey);
        if (!def) throw new ActionDefNotInManifestError(actionKey);
        const handler = this.handlers.get(actionKey);
        if (!handler) throw new MissingHandlerError(actionKey);
        return { def, handler: handler as ActionHandler<TInput, TResult> };
    }

    /**
     * Convenience: `get(key).handler(input)`. UI convenience for actions
     * that need neither MFA nor confirm.
     */
    async dispatch<TInput, TResult>(actionKey: string, input: TInput): Promise<TResult> {
        return this.get<TInput, TResult>(actionKey).handler(input);
    }

    /**
     * List of actionKeys that are declared in the manifest but have no
     * handler. Consumers use this in a doctor check to detect drift between
     * the manifest and the shell build.
     */
    listOrphanedDefs(): string[] {
        return [...this.defs.keys()].filter((k) => !this.handlers.has(k));
    }

    /**
     * List of registered handlers that are missing from the manifest. Drift
     * in the other direction.
     */
    listOrphanedHandlers(): string[] {
        return [...this.handlers.keys()].filter((k) => !this.defs.has(k));
    }
}
