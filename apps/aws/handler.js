import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapAwsPayloadToBatch } from "./mappers.js";
import { enrichAwsMetricSummary } from "./cloudwatch.js";
import { collectorRegionsFromEnvironment, discoverAwsInventory, shouldRunMetricModule } from "./discovery.js";

export async function handler(event) {
  const context = {
    collectorName: process.env.COLLECTOR_NAME || "aws-collector",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    regionCode: event.regionCode || process.env.AWS_REGION || event.region || String(process.env.COLLECTOR_REGIONS || "").split(",")[0],
    accountId: process.env.AWS_ACCOUNT_ID || event.account || process.env.CLOUD_ACCOUNT_LABEL,
    mode: "AUTOMATIC"
  };
  const inventory = event.discoveryInventory || (!event.metricType || process.env.CLOUDSIGHT_AWS_DISCOVERY === "false"
    ? null
    : await discoverAwsInventory({ regions: collectorRegionsFromEnvironment() }));
  if (event.metricType && !shouldRunMetricModule(event.metricType, inventory)) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "SKIPPED",
        reason: "No matching resources discovered for this collector module",
        metricType: event.metricType,
        discoveredServices: inventory?.services || {}
      })
    };
  }
  const enrichedEvent = await enrichAwsMetricSummary({ ...event, discoveryInventory: inventory }, context);
  const batch = mapAwsPayloadToBatch(enrichedEvent, {
    ...context
  });
  const payload = await postCollectorBatch({
    collectorName: batch.collectorName,
    batch,
    dryRun: process.env.DRY_RUN === "true"
  });
  return {
    statusCode: 200,
    body: JSON.stringify(payload)
  };
}
