// App-wide entitlement snapshot for the tenant.
//
// A single instance is provided at bootstrap (`provideEntitlement`) so that
// `<FeatureGate>` and the notes page read the same reactive plan/feature set.
// It reloads after login (see the session store) once the tenant header is set.

import { useEntitlement } from '@saasicat/ui-vue';
import { platformHttp } from './http';

export const ENTITLEMENT_ENDPOINT = '/api/v1/billing/entitlement';

// autoLoad is off: the entitlement endpoint needs the tenant header, which
// only exists after login. The session store loads it on login, and main.ts
// loads it at bootstrap when a session is already stored (hard reload).
export const entitlement = useEntitlement({
    endpoint: ENTITLEMENT_ENDPOINT,
    http: platformHttp,
    autoLoad: false,
});
