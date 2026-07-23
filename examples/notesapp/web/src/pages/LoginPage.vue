<template>
    <div class="login-wrap bg-grey-2">
        <q-card class="login-card" flat bordered>
            <q-card-section class="text-center">
                <q-icon name="sticky_note_2" size="42px" color="primary" />
                <div class="text-h5 q-mt-sm">NotesApp</div>
                <div class="text-caption text-grey-7">
                    Demo sign-in — pick a tenant id. It is sent as the
                    <code>x-demo-tenant</code> header on every request.
                </div>
            </q-card-section>

            <q-card-section>
                <q-form @submit.prevent="onSubmit">
                    <q-input
                        v-model="tenantId"
                        label="Tenant id"
                        autofocus
                        :rules="[(v) => !!(v && v.trim()) || 'Tenant id is required']"
                    />
                    <q-btn
                        type="submit"
                        color="primary"
                        class="full-width q-mt-md"
                        label="Sign in"
                        unelevated
                    />
                </q-form>
            </q-card-section>

            <q-separator />

            <q-card-section>
                <div class="text-caption text-grey-7 q-mb-sm">Quick demo tenants</div>
                <div class="column q-gutter-sm">
                    <q-btn
                        outline
                        color="primary"
                        no-caps
                        align="left"
                        @click="quickPick('tenant-a')"
                    >
                        <div class="column items-start">
                            <div class="text-weight-medium">tenant-a</div>
                            <div class="text-caption text-grey-7">Starter plan — export locked</div>
                        </div>
                    </q-btn>
                    <q-btn outline color="primary" no-caps align="left" @click="quickPick('acme')">
                        <div class="column items-start">
                            <div class="text-weight-medium">acme</div>
                            <div class="text-caption text-grey-7">
                                Pro plan — export enabled + a bundle
                            </div>
                        </div>
                    </q-btn>
                </div>
            </q-card-section>
        </q-card>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';

const DEFAULT_TENANT = 'acme';

const session = useSessionStore();
const router = useRouter();
const tenantId = ref(DEFAULT_TENANT);

function signInAs(id: string): void {
    session.login(id);
    void router.push('/notes');
}

function onSubmit(): void {
    const id = tenantId.value.trim();
    if (!id) return;
    signInAs(id);
}

function quickPick(id: string): void {
    tenantId.value = id;
    signInAs(id);
}
</script>

<style scoped>
.login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
}
.login-card {
    width: 380px;
    max-width: 92vw;
}
</style>
