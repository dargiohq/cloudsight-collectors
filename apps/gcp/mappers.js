import { buildCollectorBatch, buildCollectorEvent } from "../../shared/contract.js";

function storageAuditEvent(payload, context) {
  const sourceReference = payload.resourceName || payload.insertId || payload.protoPayload?.methodName || "storage.objects.create";
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "cloud-storage-class-a",
    outputEndpoint: "cloud-storage-class-b",
    inputUnits: 1,
    outputUnits: 0,
    timestamp: payload.timestamp || payload.receiveTimestamp || new Date().toISOString(),
    sourceType: "AUDIT_LOG",
    sourceReference,
    regionCode: payload.resource?.labels?.location || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: {
      project: payload.resource?.labels?.project_id || context.project || "",
      serviceFamily: "Cloud Storage",
      environment: context.environment || ""
    }
  });
}

function cloudRunMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "cloud-run-request",
    outputEndpoint: "cloud-run-vcpu-second",
    inputUnits: Number(payload.requests || 0),
    outputUnits: Number(payload.vcpuSeconds || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "METRIC_PULL",
    sourceReference: "cloud-run-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Cloud Run", environment: context.environment || "" }
  });
}

function geminiMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "gemini-input",
    outputEndpoint: "gemini-output",
    inputUnits: Number(payload.inputTokens || 0),
    outputUnits: Number(payload.outputTokens || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "MODEL_USAGE",
    sourceReference: payload.model || "gemini-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Gemini", environment: context.environment || "" }
  });
}

function visionMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "vision-object-detection-minute",
    outputEndpoint: "vision-warehouse-search-request",
    inputUnits: Number(payload.objectDetectionMinutes || 0),
    outputUnits: Number(payload.searchRequests || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "MODEL_USAGE",
    sourceReference: "vision-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Vision", environment: context.environment || "" }
  });
}

function gkeRuntimeEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "cloud-run-memory-gib-second",
    outputEndpoint: "gke-cluster-hour",
    inputUnits: Number(payload.memoryGibSeconds || 0),
    outputUnits: Number(payload.clusterHours || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "METRIC_PULL",
    sourceReference: "gke-runtime-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "GKE/Runtime", environment: context.environment || "" }
  });
}

function bigQueryJobEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "bigquery-query-tb",
    outputEndpoint: "bigquery-query-tb",
    inputUnits: Number(payload.terabytesScanned || 0),
    outputUnits: 0,
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "AUDIT_LOG",
    sourceReference: payload.jobType || "QUERY",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "BigQuery", environment: context.environment || "" }
  });
}

function pubSubMetricEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "pubsub-message-operation",
    outputEndpoint: "cloud-storage-class-b",
    inputUnits: Number(payload.messageOperations || 0),
    outputUnits: Number(payload.classBOperations || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    sourceType: "PUBSUB_METRIC",
    sourceReference: "pubsub-summary",
    regionCode: payload.regionCode || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: { serviceFamily: "Pub/Sub", environment: context.environment || "" }
  });
}

export function mapGcpPayloadToBatch(payload, context = {}) {
  let events = [];
  if (payload?.protoPayload?.serviceName?.includes("storage.googleapis.com")) {
    events = [storageAuditEvent(payload, context)];
  } else if (payload?.metricType === "gemini-summary") {
    events = [geminiMetricEvent(payload, context)];
  } else if (payload?.metricType === "vision-summary") {
    events = [visionMetricEvent(payload, context)];
  } else if (payload?.metricType === "cloud-run-summary") {
    events = [cloudRunMetricEvent(payload, context)];
  } else if (payload?.metricType === "gke-runtime-summary") {
    events = [gkeRuntimeEvent(payload, context)];
  } else if (payload?.metricType === "bigquery-job") {
    events = [bigQueryJobEvent(payload, context)];
  } else if (payload?.metricType === "pubsub-summary") {
    events = [pubSubMetricEvent(payload, context)];
  } else {
    throw new Error("Unsupported GCP payload shape");
  }

  return buildCollectorBatch({
    provider: "GCP",
    collectorName: context.collectorName || "gcp-collector",
    mode: context.mode || "AUTOMATIC",
    batchReference: payload.insertId || payload.batchReference || `gcp-${Date.now()}`,
    events
  });
}
