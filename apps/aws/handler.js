import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapAwsPayloadToBatch } from "./mappers.js";
import { enrichAwsMetricSummary } from "./cloudwatch.js";

export async function handler(event) {
  const context = {
    collectorName: process.env.COLLECTOR_NAME || "aws-collector",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    regionCode: event.regionCode || process.env.AWS_REGION || event.region || String(process.env.COLLECTOR_REGIONS || "").split(",")[0],
    accountId: process.env.AWS_ACCOUNT_ID || event.account || process.env.CLOUD_ACCOUNT_LABEL,
    mode: "AUTOMATIC"
  };
  const enrichedEvent = await enrichAwsMetricSummary(event, context);
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
