<template>
    <section class="pd-panel pd-audit">
        <div class="pd-panel-head">
            <div style="min-width: 0">
                <h3 class="pd-panel-title">{{ msg.auditLog.title }}</h3>
                <div class="pd-panel-sub">{{ msg.auditLog.subtitle }}</div>
            </div>
        </div>
        <div class="pd-audit-body">
            <div v-if="loadingAudit" class="pd-diff-empty">{{ msg.auditLog.loading }}</div>
            <div v-for="a in auditRows" :key="a.id" class="pd-audit-row">
                <span :class="['pd-audit-dot', `pd-audit-${auditKind(a.action)}`]" />
                <span class="pd-audit-when">{{ formatAuditDate(a.createdAt) }}</span>
                <span class="pd-audit-avatar">{{ auditInitial(a) }}</span>
                <span class="pd-audit-who">{{ auditWho(a) }}</span>
                <span class="pd-audit-what">{{ a.action }}</span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import type { AuditRow } from './types.js';

defineProps<{
    auditRows: AuditRow[];
    loadingAudit: boolean;
}>();

const msg = useSaMessages('planDetail');
const { intlLocale } = useSuperAdminI18n();

function auditKind(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('publish')) return 'publish';
    if (a.includes('create') && a.includes('draft')) return 'draft';
    if (a.includes('create')) return 'add';
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
    return auditWho(a)[0]?.toUpperCase() ?? '?';
}

function formatAuditDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const isToday = d.toDateString() === new Date().toDateString();
    const time = d.toLocaleTimeString(intlLocale.value, { hour: '2-digit', minute: '2-digit' });
    return isToday
        ? formatMessage(msg.value.auditLog.today, { time })
        : `${d.toLocaleDateString(intlLocale.value, { day: '2-digit', month: 'short' })} · ${time}`;
}
</script>
