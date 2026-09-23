import type { RouteRecordRaw } from 'vue-router';
import MainLayout from '../layouts/MainLayout.vue';
import LoginPage from '../pages/LoginPage.vue';
import NotesPage from '../pages/NotesPage.vue';
import PlanPage from '../pages/PlanPage.vue';
import BillingPage from '../pages/BillingPage.vue';

export const routes: RouteRecordRaw[] = [
    { path: '/login', component: LoginPage, meta: { public: true } },
    {
        path: '/',
        component: MainLayout,
        children: [
            { path: '', redirect: '/notes' },
            { path: 'notes', component: NotesPage },
            { path: 'plan', component: PlanPage },
            { path: 'billing', component: BillingPage },
        ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/notes' },
];
