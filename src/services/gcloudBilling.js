import { GoogleAuth } from 'google-auth-library';

const BILLING_API_BASE_URL = 'https://cloudbilling.googleapis.com/v1';
const BUDGETS_API_BASE_URL = 'https://billingbudgets.googleapis.com/v1';
const BIGQUERY_API_BASE_URL = 'https://bigquery.googleapis.com/bigquery/v2';
const AUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/cloud-billing.readonly'
];

const normalizeBillingAccountName = (billingAccountId) => {
  if (!billingAccountId) {
    return '';
  }

  return billingAccountId.startsWith('billingAccounts/')
    ? billingAccountId
    : `billingAccounts/${billingAccountId}`;
};

const extractBillingAccountId = (billingAccountName) => (
  String(billingAccountName || '').replace(/^billingAccounts\//, '')
);

const getAccessToken = async () => {
  const auth = new GoogleAuth({ scopes: AUTH_SCOPES });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  if (!token?.token) {
    throw new Error('Google authentication did not return an access token');
  }

  return token.token;
};

const googleJsonRequest = async ({ url, token, method = 'GET', body }) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.error?.message || response.statusText || 'Google API request failed';
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const safeGoogleJsonRequest = async (request, label) => {
  try {
    return {
      ok: true,
      data: await googleJsonRequest(request)
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        label,
        message: error.message,
        status: error.status || null,
        details: error.payload?.error?.details || null
      }
    };
  }
};

const resolveBillingAccount = async ({ token, projectId, configuredBillingAccountId }) => {
  const configuredName = normalizeBillingAccountName(configuredBillingAccountId);

  if (configuredName) {
    return {
      billingAccountName: configuredName,
      projectBillingInfo: null,
      source: 'env'
    };
  }

  if (!projectId) {
    return {
      billingAccountName: '',
      projectBillingInfo: null,
      source: 'missing-project'
    };
  }

  const projectBillingInfo = await googleJsonRequest({
    token,
    url: `${BILLING_API_BASE_URL}/projects/${encodeURIComponent(projectId)}/billingInfo`
  });

  return {
    billingAccountName: projectBillingInfo?.billingAccountName || '',
    projectBillingInfo,
    source: 'project'
  };
};

const listBudgets = async ({ token, billingAccountName }) => {
  if (!billingAccountName) {
    return [];
  }

  const budgets = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const payload = await googleJsonRequest({
      token,
      url: `${BUDGETS_API_BASE_URL}/${billingAccountName}/budgets?${params.toString()}`
    });

    budgets.push(...(payload?.budgets || []));
    pageToken = payload?.nextPageToken || '';
  } while (pageToken);

  return budgets;
};

const formatBudgetAmount = (budget) => {
  const specifiedAmount = budget?.amount?.specifiedAmount;
  if (!specifiedAmount) {
    return null;
  }

  return {
    currencyCode: specifiedAmount.currencyCode || null,
    units: specifiedAmount.units || '0',
    nanos: specifiedAmount.nanos || 0
  };
};

const summarizeBudgets = (budgets) => budgets.map((budget) => ({
  name: budget.name,
  displayName: budget.displayName || budget.name,
  amount: formatBudgetAmount(budget),
  creditTypesTreatment: budget.budgetFilter?.creditTypesTreatment || 'INCLUDE_ALL_CREDITS',
  calendarPeriod: budget.budgetFilter?.calendarPeriod || null,
  customPeriod: budget.budgetFilter?.customPeriod || null,
  thresholdRules: budget.thresholdRules || []
}));

const sanitizeTableIdentifier = (table) => {
  const raw = String(table || '').trim();
  const parts = raw.split('.');

  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('GCLOUD_BILLING_EXPORT_TABLE must be a full BigQuery table id: project.dataset.table');
  }

  return parts.map((part) => `\`${part}\``).join('.');
};

const buildBillingExportQuery = ({ table, lookbackDays }) => {
  const safeTable = sanitizeTableIdentifier(table);
  const safeLookbackDays = Number.isFinite(lookbackDays) && lookbackDays > 0
    ? Math.min(Math.trunc(lookbackDays), 3660)
    : 120;

  return `
WITH rows AS (
  SELECT
    service.description AS service,
    project.id AS projectId,
    COALESCE(SAFE_DIVIDE(cost, NULLIF(currency_conversion_rate, 0)), cost) AS costUsd,
    COALESCE((
      SELECT SUM(COALESCE(SAFE_DIVIDE(credit.amount, NULLIF(currency_conversion_rate, 0)), credit.amount))
      FROM UNNEST(credits) AS credit
    ), 0) AS creditsUsd,
    COALESCE((
      SELECT SUM(COALESCE(SAFE_DIVIDE(credit.amount, NULLIF(currency_conversion_rate, 0)), credit.amount))
      FROM UNNEST(credits) AS credit
      WHERE credit.type = 'PROMOTION'
    ), 0) AS promotionCreditsUsd,
    COALESCE((
      SELECT SUM(COALESCE(SAFE_DIVIDE(credit.amount, NULLIF(currency_conversion_rate, 0)), credit.amount))
      FROM UNNEST(credits) AS credit
      WHERE credit.type = 'FREE_TIER'
    ), 0) AS freeTierCreditsUsd,
    export_time AS exportTime
  FROM ${safeTable}
  WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${safeLookbackDays} DAY)
),
totals AS (
  SELECT
    SUM(costUsd) AS grossCostUsd,
    SUM(creditsUsd) AS creditsUsd,
    SUM(costUsd + creditsUsd) AS netCostUsd,
    SUM(promotionCreditsUsd) AS promotionCreditsUsd,
    SUM(freeTierCreditsUsd) AS freeTierCreditsUsd,
    SUM(IF(REGEXP_CONTAINS(LOWER(service), r'vertex ai'), costUsd, 0)) AS vertexGrossCostUsd,
    SUM(IF(REGEXP_CONTAINS(LOWER(service), r'vertex ai'), costUsd + creditsUsd, 0)) AS vertexNetCostUsd,
    SUM(IF(REGEXP_CONTAINS(LOWER(service), r'vertex ai'), promotionCreditsUsd, 0)) AS vertexPromotionCreditsUsd,
    MAX(exportTime) AS latestExportTime
  FROM rows
),
services AS (
  SELECT
    service,
    SUM(costUsd) AS grossCostUsd,
    SUM(creditsUsd) AS creditsUsd,
    SUM(costUsd + creditsUsd) AS netCostUsd
  FROM rows
  GROUP BY service
)
SELECT TO_JSON_STRING(STRUCT(
  (SELECT AS STRUCT * FROM totals) AS totals,
  ARRAY(
    SELECT AS STRUCT service, grossCostUsd, creditsUsd, netCostUsd
    FROM services
    ORDER BY ABS(netCostUsd) DESC
    LIMIT 10
  ) AS topServices
)) AS summaryJson
`.trim();
};

const roundMoney = (value) => (
  Number.isFinite(value)
    ? Math.round(value * 10000) / 10000
    : null
);

const normalizeSpendSummary = ({ rawSummary, trialCreditTotalUsd, table, lookbackDays }) => {
  if (!rawSummary?.totals) {
    return null;
  }

  const totals = rawSummary.totals;
  const promotionCreditsUsedUsd = Math.abs(Number(totals.promotionCreditsUsd || 0));
  const trialRemainingUsd = trialCreditTotalUsd > 0
    ? Math.max(trialCreditTotalUsd - promotionCreditsUsedUsd, 0)
    : null;

  return {
    source: 'bigquery-billing-export',
    table,
    lookbackDays,
    latestExportTime: totals.latestExportTime || null,
    grossCostUsd: roundMoney(Number(totals.grossCostUsd || 0)),
    creditsUsd: roundMoney(Number(totals.creditsUsd || 0)),
    netCostUsd: roundMoney(Number(totals.netCostUsd || 0)),
    promotionCreditsUsedUsd: roundMoney(promotionCreditsUsedUsd),
    freeTierCreditsUsd: roundMoney(Math.abs(Number(totals.freeTierCreditsUsd || 0))),
    trialCreditTotalUsd: trialCreditTotalUsd > 0 ? trialCreditTotalUsd : null,
    trialRemainingUsd: roundMoney(trialRemainingUsd),
    vertex: {
      grossCostUsd: roundMoney(Number(totals.vertexGrossCostUsd || 0)),
      netCostUsd: roundMoney(Number(totals.vertexNetCostUsd || 0)),
      promotionCreditsUsedUsd: roundMoney(Math.abs(Number(totals.vertexPromotionCreditsUsd || 0)))
    },
    topServices: (rawSummary.topServices || []).map((service) => ({
      service: service.service || 'Unknown service',
      grossCostUsd: roundMoney(Number(service.grossCostUsd || 0)),
      creditsUsd: roundMoney(Number(service.creditsUsd || 0)),
      netCostUsd: roundMoney(Number(service.netCostUsd || 0))
    }))
  };
};

export const getGcloudBillingSummary = async (config) => {
  if (!config.enableGcloudBillingSummary) {
    return {
      enabled: false,
      message: 'GCloud billing summary is disabled'
    };
  }

  const projectId = config.gcloudBillingProject || config.googleCloudProject || '';
  const token = await getAccessToken();
  const resolved = await resolveBillingAccount({
    token,
    projectId,
    configuredBillingAccountId: config.gcloudBillingAccountId
  });
  const billingAccountName = resolved.billingAccountName;
  const accountResult = billingAccountName
    ? await safeGoogleJsonRequest({
      token,
      url: `${BILLING_API_BASE_URL}/${billingAccountName}`
    }, 'billingAccount')
    : { ok: false, error: { label: 'billingAccount', message: 'No linked billing account was found', status: null } };
  const budgetsResult = billingAccountName
    ? await (async () => {
      try {
        return {
          ok: true,
          data: {
            budgets: await listBudgets({ token, billingAccountName })
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            label: 'budgets',
            message: error.message,
            status: error.status || null,
            details: error.payload?.error?.details || null
          }
        };
      }
    })()
    : { ok: false, error: { label: 'budgets', message: 'No billing account available for budgets lookup', status: null } };

  let spend = null;
  let spendError = null;

  if (config.gcloudBillingExportTable) {
    try {
      const query = buildBillingExportQuery({
        table: config.gcloudBillingExportTable,
        lookbackDays: config.gcloudBillingLookbackDays
      });
      const spendResult = await safeGoogleJsonRequest({
        token,
        method: 'POST',
        url: `${BIGQUERY_API_BASE_URL}/projects/${encodeURIComponent(projectId)}/queries`,
        body: {
          query,
          useLegacySql: false,
          timeoutMs: 20000,
          maxResults: 1
        }
      }, 'billingExport');

      if (spendResult.ok) {
        const summaryJson = spendResult.data?.rows?.[0]?.f?.[0]?.v;
        spend = normalizeSpendSummary({
          rawSummary: summaryJson ? JSON.parse(summaryJson) : null,
          trialCreditTotalUsd: config.gcloudTrialCreditTotalUsd,
          table: config.gcloudBillingExportTable,
          lookbackDays: config.gcloudBillingLookbackDays
        });
      } else {
        spendError = spendResult.error;
      }
    } catch (error) {
      spendError = {
        label: 'billingExport',
        message: error.message,
        status: null
      };
    }
  }

  return {
    enabled: true,
    projectId: projectId || null,
    billingAccount: {
      name: billingAccountName || null,
      id: extractBillingAccountId(billingAccountName),
      displayName: accountResult.ok ? accountResult.data?.displayName || null : null,
      open: accountResult.ok ? accountResult.data?.open ?? null : null,
      source: resolved.source
    },
    projectBillingInfo: resolved.projectBillingInfo,
    budgets: budgetsResult.ok ? summarizeBudgets(budgetsResult.data?.budgets || []) : [],
    spend,
    setup: {
      billingExportConfigured: Boolean(config.gcloudBillingExportTable),
      billingExportTable: config.gcloudBillingExportTable || null,
      trialCreditTotalUsd: config.gcloudTrialCreditTotalUsd || null,
      lookbackDays: config.gcloudBillingLookbackDays
    },
    errors: [
      accountResult.ok ? null : accountResult.error,
      budgetsResult.ok ? null : budgetsResult.error,
      spendError
    ].filter(Boolean)
  };
};
