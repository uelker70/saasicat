<template>
    <q-layout view="hHh lpR fFf">
        <q-header elevated class="bg-primary text-white">
            <q-toolbar>
                <q-icon name="sticky_note_2" size="26px" class="q-mr-sm" />
                <q-toolbar-title>NotesApp</q-toolbar-title>

                <q-tabs shrink stretch active-color="white" indicator-color="white">
                    <q-route-tab to="/notes" icon="notes" label="Notes" />
                    <q-route-tab to="/plan" icon="workspace_premium" label="Plan" />
                </q-tabs>

                <q-chip
                    class="q-ml-md"
                    icon="person"
                    color="white"
                    text-color="primary"
                    :label="tenantId ?? ''"
                />
                <q-btn flat dense icon="logout" label="Logout" class="q-ml-sm" @click="onLogout" />
            </q-toolbar>
        </q-header>

        <q-page-container>
            <router-view />
        </q-page-container>
    </q-layout>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const { tenantId } = storeToRefs(session);
const router = useRouter();

function onLogout(): void {
    session.logout();
    void router.push('/login');
}
</script>
