import { createRouter, createWebHistory } from 'vue-router'
import Chat from '../views/Chat.vue'
import Config from '../views/Config.vue'
import RequestLogs from '../views/RequestLogs.vue'
import Billing from '../views/Billing.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: Chat
    },
    {
        path: '/config',
        name: 'config',
        component: Config
    },
    {
        path: '/logs',
        name: 'logs',
        component: RequestLogs
    },
    {
        path: '/billing',
        name: 'billing',
        component: Billing
    }
  ]
})

export default router
