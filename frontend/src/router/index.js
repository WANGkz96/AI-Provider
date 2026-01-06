import { createRouter, createWebHistory } from 'vue-router'
import Chat from '../views/Chat.vue'
import Config from '../views/Config.vue'

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
    }
  ]
})

export default router
