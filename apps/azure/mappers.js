import { buildCollectorBatch, buildCollectorEvent } from "../../shared/contract.js";

function blobEvent(payload, context) {
  const eventTime = payload.eventTime || new Date().toISOString();
  return buildCollectorEvent({
    service: "AZURE",
    inputEndpoint: "blob-write",
    outputEndpoint: "blob-read",
    inputUnits: 1,
    outputUnits: 0,
    timestamp: eventTime,
    sourceType: "EVENT_GRID",
    sourceReference: payload.eventType || "Microsoft.Storage.BlobCreated",
    regionCode: payload.data?.api || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: {
      subscription: context.subscriptionId || "",
      serviceFamily: "Blob Storage",
      environment: context.environment || ""
    }
  });
}

function functionsMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "AZURE",
    inputEndpoint: "functions-execution",
    outputEndpoint: "bandwidth-egress-gb",
    inputUnits: Number(payload.executions || 0),
    outputUnits: Number(payload.egressGb || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "AZURE_MONITOR",
    sourceReference: "functions-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Functions", environment: context.environment || "" }
  });
}

function vmMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "AZURE",
    inputEndpoint: "vm-core-hour",
    outputEndpoint: "vm-memory-gb-hour",
    inputUnits: Number(payload.coreHours || 0),
    outputUnits: Number(payload.memoryGbHours || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "AZURE_MONITOR",
    sourceReference: "vm-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Virtual Machines", environment: context.environment || "" }
  });
}

function azureOpenAiEvent(payload, context) {
  return buildCollectorEvent({
    service: "AZURE",
    inputEndpoint: "azure-openai-input",
    outputEndpoint: "azure-openai-output",
    inputUnits: Number(payload.inputTokens || 0),
    outputUnits: Number(payload.outputTokens || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "USAGE_EXPORT",
    sourceReference: payload.model || "azure-openai",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Azure OpenAI", environment: context.environment || "" }
  });
}

function sqlMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "AZURE",
    inputEndpoint: "azure-sql-vcore-hour",
    outputEndpoint: "managed-disk-gb-month",
    inputUnits: Number(payload.vcoreHours || 0),
    outputUnits: Number(payload.diskGbMonth || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "AZURE_MONITOR",
    sourceReference: "sql-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Azure SQL", environment: context.environment || "" }
  });
}

function cosmosEvent(payload, context) {
  return buildCollectorEvent({
    service: "AZURE",
    inputEndpoint: "cosmosdb-request-unit",
    outputEndpoint: "managed-disk-gb-month",
    inputUnits: Number(payload.requestUnits || 0),
    outputUnits: Number(payload.diskGbMonth || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "AZURE_MONITOR",
    sourceReference: "cosmos-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Cosmos DB", environment: context.environment || "" }
  });
}

export function mapAzurePayloadToBatch(payload, context = {}) {
  let events = [];
  if (Array.isArray(payload) && payload[0]?.eventType) {
    events = payload.map((item) => blobEvent(item, context));
  } else if (payload?.eventType) {
    events = [blobEvent(payload, context)];
  } else if (payload?.metricType === "vm-summary") {
    events = [vmMetricEvent(payload, context)];
  } else if (payload?.metricType === "functions-summary") {
    events = [functionsMetricEvent(payload, context)];
  } else if (payload?.metricType === "azure-openai-summary") {
    events = [azureOpenAiEvent(payload, context)];
  } else if (payload?.metricType === "sql-summary") {
    events = [sqlMetricEvent(payload, context)];
  } else if (payload?.metricType === "cosmos-summary") {
    events = [cosmosEvent(payload, context)];
  } else {
    throw new Error("Unsupported Azure payload shape");
  }

  return buildCollectorBatch({
    provider: "AZURE",
    collectorName: context.collectorName || "azure-collector",
    mode: context.mode || "AUTOMATIC",
    batchReference: payload.id || payload.batchReference || `azure-${Date.now()}`,
    events
  });
}
