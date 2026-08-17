<template>
  <div class="min-h-screen bg-slate-900 text-slate-100">
    <Header>
      <template #actions>
        <button
          @click="loadSummary"
          :disabled="loading"
          class="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 px-4 py-1.5 rounded-lg text-sm font-medium border border-slate-700 transition-colors"
        >
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </template>
    </Header>

    <main class="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h2 class="text-lg font-semibold text-slate-100">Estimated Usage</h2>
        <p class="text-sm text-slate-500">
          {{ periodText }} / {{ usage?.timezone || '-' }}
        </p>
      </div>

      <div v-if="error" class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-200">
        {{ error }}
      </div>

      <template v-if="usage">
        <section class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-4">
            <div class="text-xs uppercase tracking-wide text-emerald-300/70">Actual Vertex AI spend</div>
            <div class="mt-2 text-2xl font-semibold text-emerald-100">{{ money(usage.summary?.actualVertexUsd) }}</div>
            <div class="mt-1 text-xs text-emerald-300/60">{{ usage.summary?.vertexRequestCount || 0 }} Vertex requests</div>
          </div>
          <div class="rounded-lg border border-cyan-800/60 bg-cyan-950/20 p-4">
            <div class="text-xs uppercase tracking-wide text-cyan-300/70">Saved on AI Studio Free Tier</div>
            <div class="mt-2 text-2xl font-semibold text-cyan-100">{{ money(usage.summary?.ecoSavedUsd) }}</div>
            <div class="mt-1 text-xs text-cyan-300/60">{{ usage.summary?.ecoFreeRequestCount || 0 }} free eco requests</div>
          </div>
        </section>

        <section class="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div class="rounded-lg border border-blue-800/60 bg-blue-950/20 p-4">
            <div class="text-xs uppercase tracking-wide text-blue-300/70">Estimated month</div>
            <div class="mt-2 text-2xl font-semibold text-blue-100">{{ money(usage.summary?.totalUsd) }}</div>
            <div class="mt-1 text-xs text-blue-300/60">Persistent ledger + audit journal, not request logs</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Priced requests</div>
            <div class="mt-2 text-2xl font-semibold text-slate-100">{{ usage.summary?.pricedRequestCount || 0 }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ usage.summary?.requestCount || 0 }} total recorded</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Top model</div>
            <div class="mt-2 truncate text-base font-semibold text-slate-100">{{ topUsageModel.name }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ money(topUsageModel.cost) }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Unpriced</div>
            <div class="mt-2 text-2xl font-semibold text-slate-100">{{ usage.summary?.unpricedRequestCount || 0 }}</div>
            <div class="mt-1 text-xs text-slate-500">No pricing rule or no usage</div>
          </div>
        </section>

        <section class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Cost By Model</h3>
              <p class="text-xs text-slate-500">Summed from persistent local cost ledger</p>
            </div>
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <thead class="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold">Model</th>
                  <th class="px-4 py-3 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                <tr v-for="row in usageModelRows" :key="row.name">
                  <td class="px-4 py-3 text-slate-200">{{ row.name }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-emerald-300">{{ money(row.cost) }}</td>
                </tr>
                <tr v-if="usageModelRows.length === 0">
                  <td colspan="2" class="px-4 py-8 text-center text-slate-500">No priced Google requests this month</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Most Expensive Requests</h3>
              <p class="text-xs text-slate-500">Open Logs for full request and response</p>
            </div>
            <div class="divide-y divide-slate-800">
              <div v-for="request in usage.summary?.topRequests || []" :key="request.id" class="px-4 py-3">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-slate-100">{{ request.model }}</div>
                    <div class="mt-1 text-xs text-slate-500">{{ formatTime(request.timestamp) }} / {{ request.type }}</div>
                  </div>
                  <div class="font-mono text-xs text-emerald-300">{{ money(request.totalUsd) }}</div>
                </div>
              </div>
              <div v-if="!usage.summary?.topRequests?.length" class="px-4 py-8 text-center text-slate-500">No expensive requests yet</div>
            </div>
          </div>
        </section>

        <section class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Cost By Type</h3>
              <p class="text-xs text-slate-500">Text, image, video, audio</p>
            </div>
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <tbody class="divide-y divide-slate-800">
                <tr v-for="row in usageTypeRows" :key="row.name">
                  <td class="px-4 py-3 text-slate-200">{{ row.name }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-emerald-300">{{ money(row.cost) }}</td>
                </tr>
                <tr v-if="usageTypeRows.length === 0">
                  <td colspan="2" class="px-4 py-8 text-center text-slate-500">No usage by type yet</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Cost By Day</h3>
              <p class="text-xs text-slate-500">Current calendar month</p>
            </div>
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <tbody class="divide-y divide-slate-800">
                <tr v-for="row in usageDayRows" :key="row.name">
                  <td class="px-4 py-3 text-slate-200">{{ row.name }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-emerald-300">{{ money(row.cost) }}</td>
                </tr>
                <tr v-if="usageDayRows.length === 0">
                  <td colspan="2" class="px-4 py-8 text-center text-slate-500">No daily usage yet</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import axios from 'axios';
import Header from '../components/Header.vue';

const usage = ref(null);
const loading = ref(false);
const error = ref('');

const rowsFromBucket = (bucket) => (
  Object.entries(bucket || {})
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost)
);

const usageModelRows = computed(() => rowsFromBucket(usage.value?.summary?.byModel));
const usageTypeRows = computed(() => rowsFromBucket(usage.value?.summary?.byType));
const usageDayRows = computed(() => rowsFromBucket(usage.value?.summary?.byDay));
const topUsageModel = computed(() => usageModelRows.value[0] || { name: '-', cost: null });
const periodText = computed(() => {
  const current = usage.value;
  if (!current) return '-';

  if (current.periodType === 'calendar-month') {
    return `${current.periodLabel || current.month || '-'} / current calendar month / persistent ledger`;
  }

  return `${current.periodLabel || current.month} / persistent ledger`;
});

const loadSummary = async () => {
  loading.value = true;
  error.value = '';

  try {
    const response = await axios.get('/usage-costs');
    usage.value = response.data;
  } catch (requestError) {
    error.value = requestError.response?.data?.error || requestError.message;
  } finally {
    loading.value = false;
  }
};

const money = (value) => (
  Number.isFinite(value)
    ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
    : '-'
);

const formatTime = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

onMounted(loadSummary);
</script>
