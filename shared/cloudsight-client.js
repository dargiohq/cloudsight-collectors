import { buildCollectorBatch } from "./contract.js";

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

  let lastFailure;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const usingSignedCollector = Boolean(collectorId && collectorKey);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/collector/events`, {
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
    if (response.ok) {
      return payload;
    }

    lastFailure = new Error(`CloudSight collector ingestion failed: ${response.status} ${renderPayload(payload, text)}`);
    if (!shouldRetry(response.status, text) || attempt === 4) {
      throw lastFailure;
    }
    await sleep(attempt * 2500);
  }

  throw lastFailure ?? new Error("CloudSight collector ingestion failed");
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
  return status === 429 || /too many requests/i.test(text || "");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
