import { createAdminResourceClient } from '@saasicat/ui-vue';
import { platformHttp } from './http';

const resources = createAdminResourceClient({ http: platformHttp });

export const {
    loadTenantDetail,
    loadUsers,
    loadAudit,
    loadSubscriptions,
    loadPromos,
    createPromo,
    updatePromo,
    deletePromo,
    suspendTenant,
    reactivateTenant,
} = resources;

export const TENANTS_ENDPOINT = resources.tenantsEndpoint;
