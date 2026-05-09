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
  collectorName,
  batch,
  dryRun = false
}) {
  required("CLOUDSIGHT_BASE_URL", baseUrl);
  required("CLOUDSIGHT_API_KEY", apiKey);
  const normalizedBatch = buildCollectorBatch({
    ...batch,
    collectorName: collectorName || batch.collectorName
  });

  if (dryRun) {
    return {
      status: "DRY_RUN",
      endpoint: `${baseUrl.replace(/\/$/, "")}/api/collector/events`,
      batch: normalizedBatch
    };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/collector/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
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
