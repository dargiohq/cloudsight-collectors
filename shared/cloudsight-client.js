import { buildCollectorBatch } from "./contract.js";

let dispatchQueue = Promise.resolve();
let nextDispatchAt = 0;

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

async function performCollectorPost({
  baseUrl,
  apiKey,
  collectorId,
  collectorKey,
  normalizedBatch
}) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/collector/events`;
  const maxAttempts = Number(process.env.CLOUDSIGHT_DISPATCH_ATTEMPTS || 10);
  let lastFailure;
  let lastPayload;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const usingSignedCollector = Boolean(collectorId && collectorKey);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-API-KEY": apiKey } : {}),
          ...(collectorId ? { "X-COLLECTOR-ID": collectorId } : {}),
          ...(collectorKey ? { "X-COLLECTOR-KEY": collectorKey } : {}),
          ...(!usingSignedCollector && normalizedBatch.collectorName
            ? { "X-COLLECTOR-NAME": normalizedBatch.collectorName }
            : {})
        },
        body: JSON.stringify(normalizedBatch)
      });

      const text = await response.text();
      const payload = safeJson(text);
      lastPayload = payload;
      if (response.ok) {
        return {
          status: "SUCCESS",
          endpoint,
          attempts: attempt,
          response: payload
        };
      }

      lastFailure = new Error(`CloudSight collector ingestion failed: ${response.status} ${renderPayload(payload, text)}`);
      if (shouldRetry(response.status, text)) {
        const fallback = await fallbackToCollectorUsageApiWithPublicFallback(baseUrl, apiKey, normalizedBatch);
        if (fallback) {
          return fallback;
        }
      }
      if (!shouldRetry(response.status, text) || attempt === maxAttempts) {
        return {
          status: shouldRetry(response.status, text) ? "RATE_LIMITED" : "ERROR",
          endpoint,
          attempts: attempt,
          httpStatus: response.status,
          error: lastFailure.message,
          response: payload
        };
      }

      await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
    } catch (error) {
      lastFailure = error instanceof Error ? error : new Error(String(error));
      if (shouldRetryNetworkError(lastFailure)) {
        const fallback = await fallbackToCollectorUsageApiWithPublicFallback(baseUrl, apiKey, normalizedBatch);
        if (fallback) {
          return fallback;
        }
      }
      if (!shouldRetryNetworkError(lastFailure) || attempt === maxAttempts) {
        return {
          status: "ERROR",
          endpoint,
          attempts: attempt,
          error: lastFailure.message,
          response: lastPayload ?? {}
        };
      }
      await sleep(retryDelayMs(attempt));
    }
  }

  const fallback = await fallbackToCollectorUsageApiWithPublicFallback(baseUrl, apiKey, normalizedBatch);
  if (fallback) {
    return fallback;
  }

  return {
    status: "ERROR",
    endpoint,
    attempts: maxAttempts,
    error: lastFailure?.message ?? "CloudSight collector ingestion failed",
    response: lastPayload ?? {}
  };
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
    const response = await fetch(endpoint, {
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

function retryDelayMs(attempt, retryAfterHeader) {
  const retryAfterSeconds = Number(retryAfterHeader || "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const base = Math.min(18000, 1800 * attempt);
  const jitter = Math.floor(Math.random() * 900);
  return base + jitter;
}

function minimumDispatchGapMs() {
  const configured = Number(process.env.CLOUDSIGHT_DISPATCH_GAP_MS || 2500);
  return Number.isFinite(configured) ? configured : 2500;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
