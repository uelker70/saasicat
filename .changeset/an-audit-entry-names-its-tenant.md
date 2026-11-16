---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

An audit entry names the tenant it concerns

`AuditPort.write` takes `tenantId`, the one tenant an entry concerns
(`SC-AUD-021`): where somebody acts in the tenant, or the tenant's running
state — its subscription, its add-ons, its suspension — is what changes. An
operator's or a run's act on the subscriber's commercial record names none.
Both shipped audit adapters write it to `audit_logs."tenantId"`, which they
left empty for every entry, so a tenant's data eraser finds the tenant's
entries, and the e-mail addresses in their actor tags, by it.

- An `AuditPort` of your own stores `tenantId`. The platform passes the key on
  every entry, `undefined` where the entry names no tenant.
- **Breaking:** `ReassignTenantAdminCliResult` requires `tenantId`, the tenant
  whose administrator `reassignTenantAdmin` replaced; a `UserManagementPort` of
  your own answers it. `user reassign-admin` writes it into its audit entry;
  `user reset-password` and `user deactivate` act on a person by e-mail and name
  no tenant.
- Entries written before carry no tenant, and nothing fills it in.
