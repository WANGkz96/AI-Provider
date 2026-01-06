<template>
  <div class="h-full bg-slate-900 overflow-y-auto">
    <Header>
        <template #actions>
            <button 
                @click="saveConfig" 
                :disabled="saving || !isValidJson"
                class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
            >
                <span v-if="saving">Saving...</span>
                <span v-else>Save Config</span>
            </button>
        </template>
    </Header>

    <div class="p-6 max-w-5xl mx-auto">
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-slate-100 mb-2">Model Configuration</h2>
        <p class="text-sm text-slate-400 mb-4">
          Edit `models.json` directly. Defines available models, their providers, and specific API IDs.
        </p>

        <div v-if="error" class="bg-red-900/30 border border-red-800 text-red-200 px-4 py-3 rounded-lg mb-4 text-sm flex items-start gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <pre class="whitespace-pre-wrap font-mono">{{ error }}</pre>
        </div>

        <div v-if="successMessage" class="bg-green-900/30 border border-green-800 text-green-200 px-4 py-3 rounded-lg mb-4 text-sm">
            {{ successMessage }}
        </div>
        
        <div class="relative group">
            <textarea
                v-model="configJson"
                class="w-full h-[600px] bg-slate-800 border rounded-xl font-mono text-sm p-4 focus:ring-2 focus:ring-blue-500 outline-none resize-y"
                :class="isValidJson ? 'border-slate-700 text-slate-200' : 'border-red-500/50 text-red-100'"
                spellcheck="false"
            ></textarea>
            <div class="absolute bottom-4 right-4 text-xs bg-slate-900/80 px-2 py-1 rounded text-slate-400 pointer-events-none">
                {{ isValidJson ? 'Valid JSON' : 'Invalid JSON' }}
            </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import Header from '../components/Header.vue';

const configJson = ref('[]');
const saving = ref(false);
const error = ref(null);
const successMessage = ref(null);

const isValidJson = computed(() => {
    try {
        JSON.parse(configJson.value);
        return true;
    } catch (e) {
        return false;
    }
});

const fetchConfig = async () => {
    try {
        const res = await axios.get('/config');
        configJson.value = JSON.stringify(res.data, null, 2);
    } catch (e) {
        error.value = 'Failed to load config: ' + e.message;
    }
};

const saveConfig = async () => {
    if (!isValidJson.value) return;
    
    saving.value = true;
    error.value = null;
    successMessage.value = null;

    try {
        const payload = JSON.parse(configJson.value);
        await axios.post('/config', payload);
        successMessage.value = 'Configuration saved successfully!';
        setTimeout(() => successMessage.value = null, 3000);
    } catch (e) {
        error.value = e.response?.data?.error || e.message;
    } finally {
        saving.value = false;
    }
};

onMounted(fetchConfig);
</script>

