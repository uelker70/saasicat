// Session store — the picked demo tenant id, mirrored to localStorage so the
// axios interceptor (services/http.ts) can read it synchronously per request.

import { defineStore } from 'pinia';
import { clearTenantId, getTenantId, setTenantId } from '../services/http';
import { entitlement } from '../services/entitlement';

interface SessionState {
    tenantId: string | null;
}

export const useSessionStore = defineStore('session', {
    state: (): SessionState => ({ tenantId: getTenantId() }),
    getters: {
        isAuthenticated: (state): boolean => !!state.tenantId,
    },
    actions: {
        login(tenantId: string): void {
            const id = tenantId.trim();
            setTenantId(id);
            this.tenantId = id;
            // Refresh entitlement now that the tenant header is set.
            void entitlement.load();
        },
        logout(): void {
            clearTenantId();
            this.tenantId = null;
        },
    },
});
