<template>
  <div class="min-h-screen bg-slate-900 text-slate-100">
    <Header>
      <template #actions>
        <button
          @click="loadLogs"
          :disabled="loading"
          class="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 px-4 py-1.5 rounded-lg text-sm font-medium border border-slate-700 transition-colors"
        >
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </template>
    </Header>

    <main class="p-6 max-w-7xl mx-auto">
      <div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-slate-100">Request Logs</h2>
          <p class="text-sm text-slate-500">
            Showing latest {{ logs.length }} of {{ meta.totalStored }} stored. Storage cap: {{ meta.storageLimit }}.
          </p>
        </div>
      </div>

      <div v-if="error" class="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-200">
        {{ error }}
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] gap-4">
        <section class="overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <thead class="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold">Time</th>
                  <th class="px-4 py-3 text-left font-semibold">Model</th>
                  <th class="px-4 py-3 text-left font-semibold">Status</th>
                  <th class="px-4 py-3 text-right font-semibold">Tokens</th>
                  <th class="px-4 py-3 text-right font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                <tr
                  v-for="entry in logs"
                  :key="entry.id"
                  @click="selectedId = entry.id"
                  class="cursor-pointer transition-colors hover:bg-slate-800/50"
                  :class="selectedId === entry.id ? 'bg-blue-950/30' : ''"
                >
                  <td class="px-4 py-3 whitespace-nowrap text-slate-300">{{ formatTime(entry.timestamp) }}</td>
                  <td class="px-4 py-3">
                    <div class="font-medium text-slate-100">{{ entry.model || '-' }}</div>
                    <div class="text-xs text-slate-500">{{ entry.provider || '-' }} / {{ entry.type || '-' }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <span
                      class="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium"
                      :class="entry.ok ? 'bg-emerald-900/40 text-emerald-200' : 'bg-red-900/40 text-red-200'"
                    >
                      {{ entry.statusCode || '-' }}
                    </span>
                    <span v-if="entry.stream" class="ml-2 text-xs text-slate-500">stream</span>
                  </td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">
                    <span>{{ tokenValue(entry.usage?.inputTokens) }}</span>
                    <span class="text-slate-600"> / </span>
                    <span>{{ tokenValue(entry.usage?.outputTokens) }}</span>
                  </td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-400">{{ entry.durationMs ?? '-' }}ms</td>
                </tr>
                <tr v-if="!loading && logs.length === 0">
                  <td colspan="5" class="px-4 py-10 text-center text-slate-500">No request logs yet</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside class="rounded-lg border border-slate-700 bg-slate-900 min-h-[520px] overflow-hidden">
          <div class="border-b border-slate-800 px-4 py-3">
            <h3 class="text-sm font-semibold text-slate-200">Details</h3>
            <p class="text-xs text-slate-500">{{ selectedEntry?.id || 'Select a request' }}</p>
          </div>
          <div v-if="selectedEntry" class="p-4 space-y-4">
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div class="rounded-lg bg-slate-800/60 p-3">
                <div class="text-slate-500">Input tokens</div>
                <div class="mt-1 font-mono text-slate-100">{{ tokenValue(selectedEntry.usage?.inputTokens) }}</div>
              </div>
              <div class="rounded-lg bg-slate-800/60 p-3">
                <div class="text-slate-500">Output tokens</div>
                <div class="mt-1 font-mono text-slate-100">{{ tokenValue(selectedEntry.usage?.outputTokens) }}</div>
              </div>
              <div class="rounded-lg bg-slate-800/60 p-3">
                <div class="text-slate-500">Total tokens</div>
                <div class="mt-1 font-mono text-slate-100">{{ tokenValue(selectedEntry.usage?.totalTokens) }}</div>
              </div>
              <div class="rounded-lg bg-slate-800/60 p-3">
                <div class="text-slate-500">Finish</div>
                <div class="mt-1 font-mono text-slate-100">{{ selectedEntry.finishReason || '-' }}</div>
              </div>
            </div>

            <div>
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Request</div>
              <pre class="max-h-[260px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-300">{{ formatJson(selectedEntry.request) }}</pre>
            </div>

            <div>
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Response</div>
              <pre class="max-h-[320px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-300">{{ formatJson(selectedEntry.response || selectedEntry.error) }}</pre>
            </div>
          </div>
          <div v-else class="flex h-[520px] items-center justify-center text-sm text-slate-500">
            Select a row
          </div>
        </aside>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import axios from 'axios';
import Header from '../components/Header.vue';

const logs = ref([]);
const loading = ref(false);
const error = ref('');
const selectedId = ref('');
const meta = ref({
  totalStored: 0,
  storageLimit: 0,
  defaultViewLimit: 100
});

const selectedEntry = computed(() => logs.value.find((entry) => entry.id === selectedId.value) || null);

const loadLogs = async () => {
  loading.value = true;
  error.value = '';

  try {
    const response = await axios.get('/request-logs', {
      params: { limit: 100 }
    });
    logs.value = response.data.entries || [];
    meta.value = {
      totalStored: response.data.totalStored || 0,
      storageLimit: response.data.storageLimit || 0,
      defaultViewLimit: response.data.defaultViewLimit || 100
    };
    if (!selectedId.value && logs.value.length > 0) {
      selectedId.value = logs.value[0].id;
    }
  } catch (requestError) {
    error.value = requestError.response?.data?.error || requestError.message;
  } finally {
    loading.value = false;
  }
};

const formatTime = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

const tokenValue = (value) => (
  Number.isFinite(value) ? value.toLocaleString() : '-'
);

const formatJson = (value) => {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

onMounted(loadLogs);
</script>
