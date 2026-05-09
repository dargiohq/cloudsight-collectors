const NON_PII_TAG_KEYS = new Set([
  "workspace",
  "environment",
  "region",
  "providerAccount",
  "project",
  "subscription",
  "serviceFamily",
  "feature",
  "team",
  "product"
]);

function nonEmpty(value) {
  return typeof value === "string" ? value.trim() : value;
}

export function sanitizeTags(tags = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(tags || {})) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = value == null ? "" : String(value).trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    if (!NON_PII_TAG_KEYS.has(normalizedKey)) {
      continue;
    }
    cleaned[normalizedKey] = normalizedValue;
  }
  return cleaned;
}

export function validateCollectorEvent(event) {
  if (!event) {
    throw new Error("Collector event is required");
  }
  if (!nonEmpty(event.service)) {
    throw new Error("Collector event service is required");
  }
  if (!nonEmpty(event.inputEndpoint)) {
    throw new Error("Collector event inputEndpoint is required");
  }
  if (!nonEmpty(event.outputEndpoint)) {
    throw new Error("Collector event outputEndpoint is required");
  }
  if (typeof event.inputUnits !== "number" || Number.isNaN(event.inputUnits) || event.inputUnits < 0) {
    throw new Error("Collector event inputUnits must be a non-negative number");
  }
  if (typeof event.outputUnits !== "number" || Number.isNaN(event.outputUnits) || event.outputUnits < 0) {
    throw new Error("Collector event outputUnits must be a non-negative number");
  }
}

export function buildCollectorEvent({
  service,
  inputEndpoint,
  outputEndpoint,
  inputUnits = 0,
  outputUnits = 0,
  timestamp = new Date().toISOString(),
  sourceType = "PROVIDER_EVENT",
  sourceReference = "",
  regionCode = "",
  deploymentEnvironment = "",
  tags = {}
}) {
  const event = {
    service: nonEmpty(service),
    inputEndpoint: nonEmpty(inputEndpoint),
    outputEndpoint: nonEmpty(outputEndpoint),
    inputUnits: Number(inputUnits || 0),
    outputUnits: Number(outputUnits || 0),
    timestamp,
    sourceType: nonEmpty(sourceType),
    sourceReference: nonEmpty(sourceReference),
    regionCode: nonEmpty(regionCode),
    deploymentEnvironment: nonEmpty(deploymentEnvironment),
    tags: sanitizeTags(tags)
  };
  validateCollectorEvent(event);
  return event;
}

export function buildCollectorBatch({
  provider,
  collectorName,
  mode = "AUTOMATIC",
  batchReference,
  events = []
}) {
  if (!nonEmpty(provider)) {
    throw new Error("Collector batch provider is required");
  }
  if (!nonEmpty(collectorName)) {
    throw new Error("Collector batch collectorName is required");
  }
  const normalizedEvents = (events || []).map((event) => {
    validateCollectorEvent(event);
    return {
      ...event,
      tags: sanitizeTags(event.tags)
    };
  });
  if (!normalizedEvents.length) {
    throw new Error("Collector batch must include at least one event");
  }
  return {
    provider: nonEmpty(provider).toUpperCase(),
    collectorName: nonEmpty(collectorName),
    mode: nonEmpty(mode) || "AUTOMATIC",
    batchReference: nonEmpty(batchReference) || `${Date.now()}`,
    events: normalizedEvents
  };
}
