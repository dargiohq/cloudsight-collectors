import { buildCollectorBatch, buildCollectorEvent } from "../../shared/contract.js";

function storageAuditEvent(payload, context) {
  return buildCollectorEvent({
    service: "GCP",
    inputEndpoint: "cloud-storage-class-a",
    outputEndpoint: "cloud-storage-class-b",
    inputUnits: 1,
    outputUnits: 0,
    timestamp: payload.timestamp || payload.receiveTimestamp || new Date().toISOString(),
    sourceType: "AUDIT_LOG",
    sourceReference: payload.protoPayload?.methodName || "storage.objects.create",
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
  } else if (payload?.metricType === "cloud-run-summary") {
    events = [cloudRunMetricEvent(payload, context)];
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
