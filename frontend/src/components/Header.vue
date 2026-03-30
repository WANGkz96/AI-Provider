<template>
  <header class="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
    <div class="flex items-center gap-6">
      <router-link to="/" class="flex items-center gap-2 group">
        <div class="bg-blue-600 p-1.5 rounded-lg group-hover:bg-blue-500 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
        </div>
        <div>
            <h1 class="text-xl font-bold text-slate-100">AI Provider</h1>
            <span class="text-xs text-slate-500">Local Gateway</span>
        </div>
      </router-link>

      <nav class="flex items-center gap-1">
        <router-link 
            to="/" 
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="$route.path === '/' ? 'text-blue-400 bg-blue-900/20' : 'text-slate-400 hover:text-slate-200'"
        >
            Chat
        </router-link>
        <router-link 
            v-if="showConfigLink"
            to="/config" 
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="$route.path === '/config' ? 'text-blue-400 bg-blue-900/20' : 'text-slate-400 hover:text-slate-200'"
        >
            Config
        </router-link>
      </nav>
    </div>
    
    <div class="flex items-center gap-4">
      <slot name="actions"></slot>
    </div>
  </header>
</template>

<script setup>
const showConfigLink = ['localhost', '127.0.0.1'].includes(window.location.hostname);
</script>

