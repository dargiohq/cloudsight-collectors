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

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/collector/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-KEY": apiKey } : {}),
      ...(collectorId ? { "X-COLLECTOR-ID": collectorId } : {}),
      ...(collectorKey ? { "X-COLLECTOR-KEY": collectorKey } : {}),
      "X-COLLECTOR-NAME": normalizedBatch.collectorName
    },
    body: JSON.stringify(normalizedBatch)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`CloudSight collector ingestion failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}
