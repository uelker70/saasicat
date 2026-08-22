import { createAdminResourceClient } from '@saasicat/ui-vue';
import { platformHttp } from './http';

const resources = createAdminResourceClient({ http: platformHttp });

export const { loadUsers, suspendTenant, reactivateTenant } = resources;
