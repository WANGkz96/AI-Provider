import { GoogleAuth } from 'google-auth-library';
import { normalizeModelId } from './ecoRouting.js';

const MONITORING_BASE = 'https://monitoring.googleapis.com/v3';
const API_KEYS_BASE = 'https://apikeys.googleapis.com/v2';
const METRIC_PREFIX = 'generativelanguage.googleapis.com/quota/generate_content_free_tier_';

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object') return Number(value.int64Value ?? value.doubleValue ?? 0);
  return 0;
};

export class EcoQuotaMonitor {
  constructor({ config, quotaLedger, fetchImpl = globalThis.fetch, authFactory, modelsProvider } = {}) {
    this.config = config;
    this.quotaLedger = quotaLedger;
    this.fetchImpl = fetchImpl;
    this.authFactory = authFactory || (() => new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }));
    this.modelsProvider = modelsProvider || (() => []);
    this.timer = null;
    this.running = false;
    this.disabledReason = null;
  }

  start() {
    if (!this.config?.ecoEnabled || !this.config?.googleUseVertex || !this.config?.googleAiStudioApiKey) {
      return;
    }

    const interval = Number(this.config.ecoQuotaSyncIntervalMs || 0);
    if (interval <= 0 || this.timer) return;
    this.timer = setInterval(() => {
      void this.sync().catch((error) => console.warn(`[EcoQuota] Monitoring sync failed: ${error.message}`));
      }, interval);
    this.timer.unref?.();
    void this.sync().catch((error) => console.warn(`[EcoQuota] Monitoring sync failed: ${error.message}`));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async getAccessToken() {
    const auth = this.authFactory();
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return typeof token === 'string' ? token : token?.token;
  }

  async resolveProject(accessToken) {
    if (this.config.googleAiStudioProject) {
      return this.config.googleAiStudioProject;
    }

    const response = await this.fetchImpl(`${API_KEYS_BASE}/keys:lookupKey?keyString=${encodeURIComponent(this.config.googleAiStudioApiKey)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || `API Keys lookup failed with HTTP ${response.status}`);
    }

    const resource = payload.parent || payload.name || '';
    const match = String(resource).match(/^projects\/([^/]+)/);
    if (!match) throw new Error('API Keys lookup returned no project');
    return match[1];
  }

  async queryMetric({ project, accessToken, metricSuffix, modelId }) {
    const metricType = `${METRIC_PREFIX}${metricSuffix}`;
    const filter = `metric.type="${metricType}"`;
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const url = new URL(`${MONITORING_BASE}/projects/${encodeURIComponent(project)}/timeSeries`);
    url.searchParams.set('filter', filter);
    url.searchParams.set('interval.startTime', startTime);
    url.searchParams.set('interval.endTime', endTime);
    url.searchParams.set('view', 'FULL');
    url.searchParams.set('pageSize', '1000');

    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Monitoring query failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const canonicalModel = normalizeModelId(modelId);
    const matchingSeries = (payload.timeSeries || []).filter((series) => {
      const labels = series.metric?.labels || {};
      const seriesModel = labels.model || labels.model_id || labels.modelId;
      return !seriesModel || normalizeModelId(seriesModel) === canonicalModel;
    });
    const points = matchingSeries.flatMap((series) => series.points || []);
    const latest = points
      .sort((a, b) => String(b.interval?.endTime || '').localeCompare(String(a.interval?.endTime || '')))[0];
    return toNumber(latest?.value);
  }

  async sync() {
    if (this.running || this.disabledReason || !this.config?.googleAiStudioApiKey || !this.quotaLedger) {
      return { skipped: true, reason: this.disabledReason || 'not_configured' };
    }
    this.running = true;
    try {
      const accessToken = await this.getAccessToken();
      const project = await this.resolveProject(accessToken);
      const configuredModels = this.modelsProvider();
      const models = configuredModels
        .filter((model) => model?.provider === 'google' && model?.eco?.enabled !== false)
        .map((model) => normalizeModelId(model.aiStudioApiModelId || model.apiModelId || model.id));
      if (models.length === 0) {
        return { skipped: true, reason: 'no_monitoring_profiles' };
      }

      for (const model of models) {
        const [rpm, usage, tpm] = await Promise.all([
          this.queryMetric({ project, accessToken, metricSuffix: 'requests/limit', modelId: normalizeModelId(model) }),
          this.queryMetric({ project, accessToken, metricSuffix: 'requests/usage', modelId: normalizeModelId(model) }),
          this.queryMetric({ project, accessToken, metricSuffix: 'input_token_count/limit', modelId: normalizeModelId(model) })
        ]);
        await this.quotaLedger.applyMonitoringProfile(model, {
          rpm: rpm || undefined,
          tpm: tpm || undefined,
          usageRpd: usage || undefined
        });
      }

      return { ok: true, project, models: models.length };
    } catch (error) {
      const message = String(error?.message || error);
      const status = Number(error?.status || error?.response?.status || 0);
      if (
        status === 401
        || status === 403
        || /quota project|permission denied|insufficient|unauthorized|forbidden/i.test(message)
      ) {
        this.disabledReason = message;
        console.warn(`[EcoQuota] Monitoring disabled: ${message}`);
        return { skipped: true, reason: 'monitoring_disabled' };
      }
      throw error;
    } finally {
      this.running = false;
    }
  }
}
