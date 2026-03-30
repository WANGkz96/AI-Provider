import { createApp } from 'vue'
import axios from 'axios'
import './style.css'
import App from './App.vue'
import router from './router'
import { ensureAccessKey, installAxiosAccessKey } from './auth'

installAxiosAccessKey(axios)
await ensureAccessKey()

const app = createApp(App)
app.use(router)
app.mount('#app')
