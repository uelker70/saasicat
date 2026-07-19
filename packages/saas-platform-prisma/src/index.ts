// @saasicat/prisma — Default-Prisma-Adapter für die
// SaaS-Plattform-Ports.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P4.
//
// Inhalt:
//   - PRISMA_CLIENT_TOKEN + PrismaLike — DI-Token + strukturelles Sub-
//     Interface für Konsumenten-PrismaService-Bindings.
//   - PrismaMfaAdapter — MfaPort gegen SuperAdminMfa-Tabelle.
//   - PrismaAuditAdapter — AuditPort gegen AuditEntry-Tabelle.
//   - AsyncLocalRlsBypassAdapter — RlsBypassPort via node:async_hooks.

export { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';
export { PrismaMfaAdapter } from './prisma-mfa.adapter.js';
export { PrismaAuditAdapter } from './prisma-audit.adapter.js';
export { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
