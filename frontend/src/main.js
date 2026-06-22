import { createApp } from 'vue'
import axios from 'axios'
import './style.css'
import App from './App.vue'
import router from './router'
import { installAxiosAccessKey } from './auth'

installAxiosAccessKey(axios)

const app = createApp(App)
app.use(router)
app.mount('#app')
