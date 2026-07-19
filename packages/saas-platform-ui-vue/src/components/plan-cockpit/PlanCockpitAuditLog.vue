<template>
    <section v-if="auditRows.length > 0 || loadingAudit" class="pc-card pc-audit-card">
        <div class="pc-card-head pc-card-head--audit">
            <div class="pc-card-head-text">
                <div class="pc-card-title">Audit-Log</div>
                <div class="pc-card-sub">Letzte Änderungen an diesem Plan</div>
            </div>
        </div>
        <div class="pc-audit">
            <div v-if="loadingAudit" class="pc-empty pc-empty--inline">Lade Audit-Log…</div>
            <div v-for="a in auditRows" :key="a.id" class="pc-audit-row">
                <span :class="['pc-audit-dot', `pc-audit-${auditKind(a.action)}`]" />
                <span class="pc-audit-when">{{ formatAuditDate(a.createdAt) }}</span>
                <span class="pc-audit-avatar">{{ auditInitial(a) }}</span>
                <span class="pc-audit-who">{{ auditWho(a) }}</span>
                <span class="pc-audit-what">{{ auditLabel(a) }}</span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { AuditRow } from './types';

defineProps<{
    auditRows: AuditRow[];
    loadingAudit: boolean;
}>();

function auditKind(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('publish')) return 'publish';
    if (a.includes('create') && a.includes('draft')) return 'draft';
    if (a.includes('create')) return 'add';
    if (a.includes('update')) return 'change';
    if (a.includes('delete')) return 'remove';
    return 'change';
}

function auditWho(a: AuditRow): string {
    if (a.user?.firstName || a.user?.lastName) {
        return `${a.user.firstName ?? ''} ${a.user.lastName ?? ''}`.trim();
    }
    return a.user?.email ?? a.userEmail ?? 'system';
}

function auditInitial(a: AuditRow): string {
    const who = auditWho(a);
    return who[0]?.toUpperCase() ?? '?';
}

function auditLabel(a: AuditRow): string {
    return a.action;
}

function formatAuditDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `heute · ${time}`;
    return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} · ${time}`;
}
</script>
