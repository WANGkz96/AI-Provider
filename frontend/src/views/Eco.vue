<template>
  <div class="min-h-screen bg-slate-900 text-slate-100">
    <Header>
      <template #actions>
        <button
          @click="loadStatus"
          :disabled="loading"
          class="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 px-4 py-1.5 rounded-lg text-sm font-medium border border-slate-700 transition-colors"
        >
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </template>
    </Header>

    <main class="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h2 class="text-lg font-semibold text-slate-100">Eco Routing</h2>
        <p class="text-sm text-slate-500">AI Studio Free Tier usage, local quota reservations and Vertex fallback state</p>
      </div>

      <div v-if="error" class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-200">
        {{ error }}
      </div>

      <template v-if="status">
        <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Route status</div>
            <div class="mt-2 text-xl font-semibold" :class="status.active ? 'text-emerald-300' : 'text-amber-300'">
              {{ status.active ? 'Active' : 'Fallback only' }}
            </div>
            <div class="mt-1 text-xs text-slate-500">Google mode: {{ status.googleMode }} / key: {{ status.aiStudioConfigured ? 'configured' : 'missing' }}</div>
          </div>
          <div class="rounded-lg border border-cyan-800/60 bg-cyan-950/20 p-4">
            <div class="text-xs uppercase tracking-wide text-cyan-300/70">Pacific daily reset</div>
            <div class="mt-2 text-xl font-semibold text-cyan-100">{{ formatDuration(secondsLeft) }}</div>
            <div class="mt-1 text-xs text-cyan-300/60">{{ formatTime(status.nextPacificResetAt) }} / {{ status.timezone }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">AI Studio availability</div>
            <div class="mt-2 text-xl font-semibold" :class="status.availability?.ok ? 'text-emerald-300' : 'text-amber-300'">
              {{ status.availability?.ok ? 'Available' : 'Unavailable' }}
            </div>
            <div class="mt-1 text-xs text-slate-500">{{ status.availability?.modelCount || 0 }} models / cached: {{ status.availability?.cached ? 'yes' : 'no' }}</div>
          </div>
        </section>

        <section class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <div class="text-sm font-semibold text-slate-200">Monitoring</div>
            <div class="mt-2 text-sm" :class="status.monitoring?.disabledReason ? 'text-amber-300' : 'text-emerald-300'">
              {{ status.monitoring?.disabledReason ? 'Disabled, local limits remain active' : (status.monitoring?.scheduled ? 'Scheduled' : 'Not scheduled') }}
            </div>
            <p v-if="status.monitoring?.disabledReason" class="mt-2 text-xs leading-5 text-slate-500">{{ status.monitoring.disabledReason }}</p>
            <p v-else class="mt-2 text-xs leading-5 text-slate-500">Sync interval: {{ formatInterval(status.monitoring?.intervalMs) }}</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900 p-4">
            <div class="text-sm font-semibold text-slate-200">Local ledger</div>
            <div class="mt-2 text-sm text-slate-300">{{ status.ledger?.reservationCount || 0 }} reservations</div>
            <p class="mt-2 text-xs leading-5 text-slate-500">Pacific date: {{ status.pacificDate }}. Ledger persists counters only, not prompts or responses.</p>
          </div>
        </section>

        <section class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
          <div class="border-b border-slate-800 px-4 py-3">
            <h3 class="text-sm font-semibold text-slate-200">Model Quotas</h3>
            <p class="text-xs text-slate-500">RPM and RPD are local reservations; unknown live limits stay on Vertex.</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <thead class="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold">Model</th>
                  <th class="px-4 py-3 text-left font-semibold">AI Studio</th>
                  <th class="px-4 py-3 text-right font-semibold">RPM</th>
                  <th class="px-4 py-3 text-right font-semibold">RPD</th>
                  <th class="px-4 py-3 text-right font-semibold">TPM</th>
                  <th class="px-4 py-3 text-right font-semibold">Next RPM reset</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                <tr v-for="model in status.models || []" :key="model.id">
                  <td class="px-4 py-3">
                    <div class="font-medium text-slate-200">{{ model.id }}</div>
                    <div class="mt-1 text-xs text-slate-500">{{ model.profile?.quotaSource || 'unknown' }}</div>
                  </td>
                  <td class="px-4 py-3" :class="model.aiStudioAvailable === false ? 'text-amber-300' : 'text-emerald-300'">
                    {{ model.aiStudioAvailable === null ? 'unknown' : (model.aiStudioAvailable ? 'available' : 'not found') }}
                  </td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">{{ quotaCell(model, 'rpm') }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">{{ quotaCell(model, 'rpd') }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">{{ quotaCell(model, 'tpm') }}</td>
                  <td class="px-4 py-3 text-right text-xs text-slate-400">{{ model.secondsUntilRpmReset === null ? '-' : formatDuration(model.secondsUntilRpmReset) }}</td>
                </tr>
                <tr v-if="!status.models?.length">
                  <td colspan="6" class="px-4 py-8 text-center text-slate-500">No configured eco models</td>
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
import { onMounted, onUnmounted, ref } from 'vue';
import axios from 'axios';
import Header from '../components/Header.vue';

const status = ref(null);
const loading = ref(false);
const error = ref('');
const secondsLeft = ref(0);
let countdownTimer = null;

const loadStatus = async () => {
  loading.value = true;
  error.value = '';

  try {
    const response = await axios.get('/eco/status');
    status.value = response.data;
    secondsLeft.value = response.data.secondsUntilPacificReset || 0;
  } catch (requestError) {
    error.value = requestError.response?.data?.error || requestError.message;
  } finally {
    loading.value = false;
  }
};

const formatDuration = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
};

const formatInterval = (value) => {
  const minutes = Math.round((Number(value) || 0) / 60000);
  return minutes > 0 ? `${minutes} min` : '-';
};

const formatTime = (value) => (value ? new Date(value).toLocaleString() : '-');

const quotaCell = (model, key) => {
  const limit = model.quota?.limits?.[key];
  const used = model.quota?.usage?.[key] || 0;
  const left = model.remaining?.[key];
  if (limit === null || limit === undefined) return `${used} / unknown`;
  return `${used} / ${limit} (${left} left)`;
};

onMounted(() => {
  loadStatus();
  countdownTimer = window.setInterval(() => {
    secondsLeft.value = Math.max(0, secondsLeft.value - 1);
  }, 1000);
});

onUnmounted(() => {
  if (countdownTimer) window.clearInterval(countdownTimer);
});
</script>
