import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/Dashboard.vue'),
    },
    {
      path: '/interests',
      name: 'interests',
      component: () => import('../views/Interests.vue'),
    },
    {
      path: '/interests/:id',
      name: 'interest-detail',
      component: () => import('../views/InterestDetail.vue'),
    },
    {
      path: '/updates',
      name: 'updates',
      component: () => import('../views/Updates.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
    },
  ],
});

export default router;
