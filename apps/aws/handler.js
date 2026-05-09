import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapAwsPayloadToBatch } from "./mappers.js";

export async function handler(event) {
  const batch = mapAwsPayloadToBatch(event, {
    collectorName: process.env.COLLECTOR_NAME || "aws-collector",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    regionCode: process.env.AWS_REGION || event.region,
    accountId: process.env.AWS_ACCOUNT_ID || event.account,
    mode: "AUTOMATIC"
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
