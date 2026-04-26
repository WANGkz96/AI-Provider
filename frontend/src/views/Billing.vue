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
        <h2 class="text-lg font-semibold text-slate-100">GCloud Billing</h2>
        <p class="text-sm text-slate-500">
          {{ summary?.projectId || 'No project detected' }} / estimated API usage for {{ usage?.month || '-' }}
        </p>
      </div>

      <div v-if="error" class="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-200">
        {{ error }}
      </div>

      <template v-if="summary">
        <section v-if="usage" class="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div class="rounded-lg border border-blue-800/60 bg-blue-950/20 p-4">
            <div class="text-xs uppercase tracking-wide text-blue-300/70">Estimated month</div>
            <div class="mt-2 text-2xl font-semibold text-blue-100">{{ money(usage.summary?.totalUsd) }}</div>
            <div class="mt-1 text-xs text-blue-300/60">From {{ usage.startDate || 'first logged request' }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Priced requests</div>
            <div class="mt-2 text-2xl font-semibold text-slate-100">{{ usage.summary?.pricedRequestCount || 0 }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ usage.timezone }}</div>
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

        <section v-if="usage" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Estimated Cost By Model</h3>
              <p class="text-xs text-slate-500">Calculated from `/run` usage and public Google pricing</p>
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

        <section class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Billing account</div>
            <div class="mt-2 text-base font-semibold text-slate-100">{{ summary.billingAccount?.displayName || summary.billingAccount?.id || '-' }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ summary.billingAccount?.name || '-' }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Status</div>
            <div class="mt-2 text-base font-semibold" :class="summary.billingAccount?.open ? 'text-emerald-300' : 'text-red-300'">
              {{ summary.billingAccount?.open === null ? '-' : (summary.billingAccount?.open ? 'Open' : 'Closed') }}
            </div>
            <div class="mt-1 text-xs text-slate-500">Source: {{ summary.billingAccount?.source || '-' }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Budgets</div>
            <div class="mt-2 text-base font-semibold text-slate-100">{{ summary.budgets?.length || 0 }}</div>
            <div class="mt-1 text-xs text-slate-500">Cloud Billing Budget API</div>
          </div>
        </section>

        <section v-if="summary.spend" class="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div class="rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-4">
            <div class="text-xs uppercase tracking-wide text-emerald-300/70">Trial remaining</div>
            <div class="mt-2 text-2xl font-semibold text-emerald-200">{{ money(summary.spend.trialRemainingUsd) }}</div>
            <div class="mt-1 text-xs text-emerald-300/60">of {{ money(summary.spend.trialCreditTotalUsd) }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Promotion credits used</div>
            <div class="mt-2 text-2xl font-semibold text-slate-100">{{ money(summary.spend.promotionCreditsUsedUsd) }}</div>
            <div class="mt-1 text-xs text-slate-500">Lookback: {{ summary.spend.lookbackDays }} days</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Net cost</div>
            <div class="mt-2 text-2xl font-semibold text-slate-100">{{ money(summary.spend.netCostUsd) }}</div>
            <div class="mt-1 text-xs text-slate-500">Gross {{ money(summary.spend.grossCostUsd) }}</div>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">Vertex AI net</div>
            <div class="mt-2 text-2xl font-semibold text-slate-100">{{ money(summary.spend.vertex?.netCostUsd) }}</div>
            <div class="mt-1 text-xs text-slate-500">Credits {{ money(summary.spend.vertex?.promotionCreditsUsedUsd) }}</div>
          </div>
        </section>

        <section v-else class="rounded-lg border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          BigQuery billing export is not configured. Set GCLOUD_BILLING_EXPORT_TABLE to show spend, Vertex AI cost, and trial credit remaining.
        </section>

        <section class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Top Services</h3>
              <p class="text-xs text-slate-500">{{ summary.spend?.latestExportTime ? `Updated ${formatTime(summary.spend.latestExportTime)}` : 'Waiting for billing export' }}</p>
            </div>
            <table class="min-w-full divide-y divide-slate-800 text-sm">
              <thead class="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th class="px-4 py-3 text-left font-semibold">Service</th>
                  <th class="px-4 py-3 text-right font-semibold">Gross</th>
                  <th class="px-4 py-3 text-right font-semibold">Credits</th>
                  <th class="px-4 py-3 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                <tr v-for="service in summary.spend?.topServices || []" :key="service.service">
                  <td class="px-4 py-3 text-slate-200">{{ service.service }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">{{ money(service.grossCostUsd) }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">{{ money(service.creditsUsd) }}</td>
                  <td class="px-4 py-3 text-right font-mono text-xs text-slate-300">{{ money(service.netCostUsd) }}</td>
                </tr>
                <tr v-if="!summary.spend?.topServices?.length">
                  <td colspan="4" class="px-4 py-8 text-center text-slate-500">No billing export rows</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
            <div class="border-b border-slate-800 px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-200">Budgets</h3>
              <p class="text-xs text-slate-500">Configured on the billing account</p>
            </div>
            <div class="divide-y divide-slate-800">
              <div v-for="budget in summary.budgets || []" :key="budget.name" class="px-4 py-3">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-sm font-medium text-slate-100">{{ budget.displayName }}</div>
                    <div class="mt-1 text-xs text-slate-500">{{ budget.calendarPeriod || periodLabel(budget.customPeriod) || '-' }}</div>
                  </div>
                  <div class="font-mono text-xs text-slate-300">{{ budgetAmount(budget.amount) }}</div>
                </div>
              </div>
              <div v-if="!summary.budgets?.length" class="px-4 py-8 text-center text-slate-500">No budgets found</div>
            </div>
          </div>
        </section>

        <section v-if="summary.errors?.length" class="rounded-lg border border-red-900/70 bg-red-950/20 p-4">
          <h3 class="text-sm font-semibold text-red-200">API Errors</h3>
          <div class="mt-3 space-y-2">
            <div v-for="apiError in summary.errors" :key="`${apiError.label}-${apiError.message}`" class="text-sm text-red-100">
              <span class="font-medium">{{ apiError.label }}:</span> {{ apiError.message }}
            </div>
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

const summary = ref(null);
const usage = ref(null);
const loading = ref(false);
const error = ref('');

const loadSummary = async () => {
  loading.value = true;
  error.value = '';

  try {
    const [billingResult, usageResult] = await Promise.allSettled([
      axios.get('/billing/summary'),
      axios.get('/usage-costs')
    ]);

    if (billingResult.status === 'fulfilled') {
      summary.value = billingResult.value.data;
    } else {
      summary.value = { errors: [{ label: 'billingSummary', message: billingResult.reason?.message || 'Failed to load billing summary' }] };
    }

    if (usageResult.status === 'fulfilled') {
      usage.value = usageResult.value.data;
    } else {
      error.value = usageResult.reason?.response?.data?.error || usageResult.reason?.message || 'Failed to load usage costs';
    }
  } catch (requestError) {
    error.value = requestError.response?.data?.details || requestError.response?.data?.error || requestError.message;
  } finally {
    loading.value = false;
  }
};

const usageModelRows = computed(() => (
  Object.entries(usage.value?.summary?.byModel || {})
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost)
));

const topUsageModel = computed(() => usageModelRows.value[0] || { name: '-', cost: null });

const money = (value) => (
  Number.isFinite(value)
    ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    : '-'
);

const budgetAmount = (amount) => {
  if (!amount) return '-';
  const units = Number(amount.units || 0);
  const nanos = Number(amount.nanos || 0) / 1_000_000_000;
  const value = units + nanos;
  return `${amount.currencyCode || ''} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
};

const periodLabel = (customPeriod) => {
  if (!customPeriod?.startDate) return '';
  const start = Object.values(customPeriod.startDate).filter(Boolean).join('-');
  const end = customPeriod.endDate ? Object.values(customPeriod.endDate).filter(Boolean).join('-') : 'open';
  return `${start} - ${end}`;
};

const formatTime = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString();
};

onMounted(loadSummary);
</script>
