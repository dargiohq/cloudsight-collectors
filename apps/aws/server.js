import { createJsonServer } from "../../shared/http.js";
import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapAwsPayloadToBatch } from "./mappers.js";

const port = Number(process.env.PORT || 9093);

const server = createJsonServer(async ({ body }) => {
  const batch = mapAwsPayloadToBatch(body, {
    collectorName: process.env.COLLECTOR_NAME || "aws-collector",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    regionCode: process.env.AWS_REGION || body.region,
    accountId: process.env.AWS_ACCOUNT_ID || body.account,
    mode: "AUTOMATIC"
  });
  return postCollectorBatch({
    collectorName: batch.collectorName,
    batch,
    dryRun: process.env.DRY_RUN === "true"
  });
});

server.listen(port, () => {
  console.log(`AWS collector listening on :${port}`);
});
