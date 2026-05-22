import { buildCollectorBatch } from "./contract.js";

let dispatchQueue = Promise.resolve();
let nextDispatchAt = 0;
const DEFAULT_FETCH_TIMEOUT_MS = 180000;
const DEFAULT_DISPATCH_ATTEMPTS = 5;
const DEFAULT_WAKE_ATTEMPTS = 3;

function required(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function postCollectorBatch({
  baseUrl = process.env.CLOUDSIGHT_BASE_URL,
  apiKey = process.env.CLOUDSIGHT_API_KEY,
  collectorId = process.env.CLOUDSIGHT_COLLECTOR_ID,
  collectorKey = process.env.CLOUDSIGHT_COLLECTOR_KEY,
  collectorName,
  batch,
  dryRun = false
}) {
  required("CLOUDSIGHT_BASE_URL", baseUrl);
  if (!collectorId || !collectorKey) {
    required("CLOUDSIGHT_API_KEY", apiKey);
  }
  const normalizedBatch = buildCollectorBatch({
    ...batch,
    collectorName: collectorName || batch.collectorName
  });

  if (dryRun) {
    return {
      status: "DRY_RUN",
      endpoint: `${baseUrl.replace(/\/$/, "")}/api/collector/events`,
      authMode: collectorId && collectorKey ? "COLLECTOR_KEY" : "WORKSPACE_API_KEY",
      batch: normalizedBatch
    };
  }

  return enqueueDispatch(() => performCollectorPost({
    baseUrl,
    apiKey,
    collectorId,
    collectorKey,
    normalizedBatch
  }));
}

function collectorHeaders({ apiKey, collectorId, collectorKey, normalizedBatch }) {
  const usingSignedCollector = Boolean(collectorId && collectorKey);
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-KEY": apiKey } : {}),
    ...(collectorId ? { "X-COLLECTOR-ID": collectorId } : {}),
    ...(collectorKey ? { "X-COLLECTOR-KEY": collectorKey } : {}),
    ...(!usingSignedCollector && normalizedBatch.collectorName
      ? { "X-COLLECTOR-NAME": normalizedBatch.collectorName }
      : {})
  };
}

function publicFallbackBaseUrl(baseUrl) {
  const configured = process.env.CLOUDSIGHT_PUBLIC_BASE_URL;
  if (configured) {
    return configured;
  }
  if (/^https:\/\/dargio-cloudsight-backend\.onrender\.com\/?$/i.test(String(baseUrl || ""))) {
    return String(baseUrl || "");
  }
  return "https://dargio-cloudsight-backend.onrender.com";
}

function derivedInternalBaseUrls(baseUrl) {
  const candidates = [];

  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  if (/dargio-cloudsight-backend\.onrender\.com/i.test(normalized)) {
    candidates.push(
      "http://dargio-cloudsight-backend:10000",
      "http://dargio-cloudsight-backend-discovery:10000",
      "http://dargio-cloudsight-backend",
      "http://dargio-cloudsight-backend:8080"
    );
  }

  const configured = String(process.env.CLOUDSIGHT_INTERNAL_BASE_URL || "").trim();
  if (configured) {
    candidates.push(configured);
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function performCollectorPost({
  baseUrl,
  apiKey,
  collectorId,
  collectorKey,
  normalizedBatch
}) {
  const maxAttempts = Number(process.env.CLOUDSIGHT_DISPATCH_ATTEMPTS || DEFAULT_DISPATCH_ATTEMPTS);
  const candidates = await discoverCandidateBaseUrls(baseUrl);
  const attemptedCandidates = [];
  const candidateErrors = [];
  let lastFailure;
  let lastPayload;
  let lastEndpoint = `${String(baseUrl || "").replace(/\/$/, "")}/api/collector/events`;
  let lastHttpStatus;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let retryAfterHeader = null;
    let shouldBackoff = false;

    for (const candidateBaseUrl of candidates) {
      const endpoint = `${candidateBaseUrl}/api/collector/events`;
      lastEndpoint = endpoint;
      attemptedCandidates.push(endpoint);
      try {
        if (warmCloudSightEnabled()) {
          await warmCloudSightBase(candidateBaseUrl);
        }
        const response = await timedFetch(endpoint, {
          method: "POST",
          headers: collectorHeaders({
            apiKey,
            collectorId,
            collectorKey,
            normalizedBatch
          }),
          body: JSON.stringify(normalizedBatch)
        });

        const text = await response.text();
        const payload = safeJson(text);
        lastPayload = payload;
        lastHttpStatus = response.status;
        if (response.ok) {
          return {
            status: "SUCCESS",
            endpoint,
            attempts: attempt,
            candidatesTried: [...new Set(attemptedCandidates)],
            candidateErrors,
            response: payload
          };
        }

        lastFailure = new Error(`CloudSight collector ingestion failed: ${response.status} ${renderPayload(payload, text)}`);
        candidateErrors.push({
          endpoint,
          attempt,
          httpStatus: response.status,
          error: lastFailure.message
        });
        if (shouldRetry(response.status, text)) {
          shouldBackoff = true;
          retryAfterHeader = retryAfterHeader || response.headers.get("retry-after");
          continue;
        }

        return {
          status: "ERROR",
          endpoint,
          attempts: attempt,
          candidatesTried: [...new Set(attemptedCandidates)],
          candidateErrors,
          httpStatus: response.status,
          error: lastFailure.message,
          response: payload
        };
      } catch (error) {
        lastFailure = error instanceof Error ? error : new Error(String(error));
        candidateErrors.push({
          endpoint,
          attempt,
          error: lastFailure.message
        });
        if (shouldRetryNetworkError(lastFailure)) {
          shouldBackoff = true;
          continue;
        }

        return {
          status: "ERROR",
          endpoint,
          attempts: attempt,
          candidatesTried: [...new Set(attemptedCandidates)],
          candidateErrors,
          error: lastFailure.message,
          response: lastPayload ?? {}
        };
      }
    }

    if (attempt === maxAttempts || !shouldBackoff) {
      break;
    }

    await sleep(retryDelayMs(attempt, retryAfterHeader));
  }

  if (directUsageFallbackAllowed()) {
    const fallback = await fallbackToCollectorUsageApiWithPublicFallback(baseUrl, apiKey, normalizedBatch);
    if (fallback) {
      return fallback;
    }
  }

  return {
    status: isRetryableFailure(lastFailure, lastHttpStatus, lastPayload) ? "RATE_LIMITED" : "ERROR",
    endpoint: lastEndpoint,
    attempts: maxAttempts,
    candidatesTried: [...new Set(attemptedCandidates)],
    candidateErrors,
    httpStatus: lastHttpStatus,
    error: lastFailure?.message ?? "CloudSight collector ingestion failed",
    response: lastPayload ?? {}
  };
}

async function discoverCandidateBaseUrls(baseUrl) {
  const configuredBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const publicBaseUrl = publicFallbackBaseUrl(baseUrl).replace(/\/$/, "");
  const configuredInternalBaseUrls = derivedInternalBaseUrls(baseUrl).map((value) => value.replace(/\/$/, ""));
  const candidates = [];

  candidates.push(...configuredInternalBaseUrls);

  if (configuredBaseUrl) {
    candidates.push(configuredBaseUrl);
  }
  if (publicBaseUrl) {
    candidates.push(publicBaseUrl);
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function warmCloudSightBase(baseUrl) {
  const attempts = Number(process.env.CLOUDSIGHT_WAKE_ATTEMPTS || DEFAULT_WAKE_ATTEMPTS);
  if (!Number.isFinite(attempts) || attempts <= 0) {
    return false;
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/health`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await timedFetch(endpoint, { method: "GET" });
      const text = await response.text();
      if (response.ok) {
        return true;
      }
      lastError = new Error(`CloudSight wake failed: ${response.status} ${renderPayload(safeJson(text), text)}`);
      if (!shouldRetry(response.status, text)) {
        return false;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!shouldRetryNetworkError(lastError)) {
        return false;
      }
    }

    if (attempt < attempts) {
      await sleep(10000 * attempt);
    }
  }

  return false;
}

function warmCloudSightEnabled() {
  return String(process.env.CLOUDSIGHT_ENABLE_WAKE || "").trim().toLowerCase() === "true";
}
function directUsageFallbackAllowed() {
  const explicit = String(process.env.CLOUDSIGHT_ALLOW_DIRECT_USAGE_FALLBACK || "").trim().toLowerCase();
  return explicit === "true";
}

function isRetryableFailure(error, httpStatus, payload) {
  if (typeof httpStatus === "number" && shouldRetry(httpStatus, JSON.stringify(payload || {}))) {
    return true;
  }
  return shouldRetryNetworkError(error);
}

async function fallbackToCollectorUsageApiWithPublicFallback(baseUrl, apiKey, normalizedBatch) {
  if (!apiKey) {
    return null;
  }

  const candidates = [...new Set([
    baseUrl,
    publicFallbackBaseUrl(baseUrl)
  ].filter(Boolean))];

  let lastError;
  for (const candidate of candidates) {
    try {
      const result = await fallbackToCollectorUsageApi(candidate, apiKey, normalizedBatch);
      if (result) {
        if (candidate !== baseUrl) {
          result.relayBaseUrl = candidate;
        }
        return result;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

function enqueueDispatch(task) {
  const scheduled = dispatchQueue
    .catch(() => undefined)
    .then(async () => {
      const waitMs = Math.max(0, nextDispatchAt - Date.now());
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      const result = await task();
      nextDispatchAt = Date.now() + minimumDispatchGapMs();
      return result;
    });
  dispatchQueue = scheduled.catch(() => undefined);
  return scheduled;
}

function safeJson(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      rawText: text.trim()
    };
  }
}

function renderPayload(payload, rawText) {
  if (payload && typeof payload === "object" && Object.keys(payload).length > 0) {
    return JSON.stringify(payload);
  }
  return JSON.stringify({ rawText: rawText?.trim?.() ?? "" });
}

function shouldRetry(status, text) {
  return status === 429
    || status === 502
    || status === 503
    || status === 504
    || /too many requests|bad gateway|service unavailable|gateway timeout/i.test(text || "");
}

function shouldRetryNetworkError(error) {
  const message = String(error?.message || "");
  return /timed out|timeout|econnreset|econnrefused|fetch failed|socket hang up|network/i.test(message);
}

async function fallbackToCollectorUsageApi(baseUrl, apiKey, normalizedBatch) {
  if (!apiKey) {
    return null;
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/usage`;
  const storedEvents = [];
  for (const event of normalizedBatch.events || []) {
    const response = await timedFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({
        service: event.service,
        inputEndpoint: event.inputEndpoint,
        outputEndpoint: event.outputEndpoint,
        inputUnits: event.inputUnits,
        outputUnits: event.outputUnits,
        timestamp: event.timestamp
      })
    });

    const text = await response.text();
    const payload = safeJson(text);
    if (!response.ok) {
      return {
        status: "ERROR",
        endpoint,
        httpStatus: response.status,
        error: `Collector usage relay failed: ${response.status} ${renderPayload(payload, text)}`,
        response: payload
      };
    }

    storedEvents.push({
      service: event.service,
      inputEndpoint: event.inputEndpoint,
      outputEndpoint: event.outputEndpoint,
      inputUnits: event.inputUnits,
      outputUnits: event.outputUnits,
      timestamp: payload.timestamp || event.timestamp,
      calculatedCost: payload.calculatedCost,
      collectorName: normalizedBatch.collectorName,
      sourceType: event.sourceType,
      sourceReference: event.sourceReference,
      regionCode: event.regionCode,
      deploymentEnvironment: event.deploymentEnvironment,
      ingestionMode: "COLLECTOR_RELAY",
      pricingSource: payload.pricingSource || "API"
    });
  }

  return {
    status: "SUCCESS",
    endpoint,
    attempts: 1,
    deliveryMode: "COLLECTOR_USAGE_RELAY",
    response: {
      status: "SUCCESS",
      provider: normalizedBatch.provider,
      collectorName: normalizedBatch.collectorName,
      batchReference: normalizedBatch.batchReference,
      mode: normalizedBatch.mode,
      stored: storedEvents.length,
      results: storedEvents
    }
  };
}

async function timedFetch(url, options = {}) {
  const timeoutMs = Number(process.env.CLOUDSIGHT_FETCH_TIMEOUT_MS || DEFAULT_FETCH_TIMEOUT_MS);
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  return fetch(url, {
    ...options,
    signal
  });
}

function retryDelayMs(attempt, retryAfterHeader) {
  const retryAfterSeconds = Number(retryAfterHeader || "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const base = Math.min(20000, 2500 * attempt);
  const jitter = Math.floor(Math.random() * 1200);
  return base + jitter;
}

function minimumDispatchGapMs() {
  const configured = Number(process.env.CLOUDSIGHT_DISPATCH_GAP_MS || 2500);
  return Number.isFinite(configured) ? configured : 2500;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
