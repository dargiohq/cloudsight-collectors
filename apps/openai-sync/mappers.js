import { buildCollectorBatch, buildCollectorEvent } from "../../shared/contract.js";

function normalizeModel(model = "") {
  const value = String(model).trim().toLowerCase();
  if (value.includes("gpt-4.1")) {
    return ["gpt-4.1-input", "gpt-4.1-output"];
  }
  if (value.startsWith("o3")) {
    return ["o3-input", "o3-output"];
  }
  if (value.includes("embedding")) {
    return ["embeddings-input", "embeddings-output"];
  }
  if (value.includes("gpt-4o-mini")) {
    return ["gpt-4o-mini-input", "gpt-4o-mini-output"];
  }
  return ["gpt-4-input", "gpt-4-output"];
}

function recordToEvent(record, context) {
  const [inputEndpoint, outputEndpoint] = normalizeModel(record.model);
  return buildCollectorEvent({
    service: "OPENAI",
    inputEndpoint,
    outputEndpoint,
    inputUnits: Number(record.inputTokens || record.input_tokens || 0),
    outputUnits: Number(record.outputTokens || record.output_tokens || 0),
    timestamp: record.timestamp || new Date().toISOString(),
    sourceType: "OPENAI_USAGE_API",
    sourceReference: record.model || "openai-usage-sync",
    regionCode: context.regionCode,
    deploymentEnvironment: context.environment,
    tags: {
      serviceFamily: "OpenAI",
      environment: context.environment || "",
      feature: record.feature || ""
    }
  });
}

export function mapOpenAiUsagePayloadToBatch(payload, context = {}) {
  const records = payload.records
    || payload.data?.flatMap((bucket) => bucket.results || [])
    || [];
  if (!records.length) {
    throw new Error("OpenAI payload did not include usage records");
  }

  const events = records.map((record) => recordToEvent(record, context));
  return buildCollectorBatch({
    provider: "OPENAI",
    collectorName: context.collectorName || "openai-sync",
    mode: context.mode || "AUTOMATIC",
    batchReference: payload.batchReference || `openai-${Date.now()}`,
    events
  });
}
