import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapOpenAiUsagePayloadToBatch } from "./mappers.js";

async function fetchUsagePayload() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const sourceUrl = process.env.OPENAI_USAGE_URL || "https://api.openai.com/v1/organization/usage/completions";
  const response = await fetch(sourceUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`OpenAI usage fetch failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function runOpenAiSync({ dryRun = process.env.DRY_RUN === "true" } = {}) {
  const payload = await fetchUsagePayload();
  const batch = mapOpenAiUsagePayloadToBatch(payload, {
    collectorName: process.env.COLLECTOR_NAME || "openai-sync",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    mode: "AUTOMATIC"
  });

  return postCollectorBatch({
    collectorName: batch.collectorName,
    batch,
    dryRun
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runOpenAiSync()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
