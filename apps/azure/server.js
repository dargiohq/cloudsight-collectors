import { createJsonServer } from "../../shared/http.js";
import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapAzurePayloadToBatch } from "./mappers.js";

const port = Number(process.env.PORT || 9095);

const server = createJsonServer(async ({ body }) => {
  const batch = mapAzurePayloadToBatch(body, {
    collectorName: process.env.COLLECTOR_NAME || "azure-collector",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    regionCode: process.env.AZURE_REGION || body.regionCode,
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    mode: "AUTOMATIC"
  });
  return postCollectorBatch({
    collectorName: batch.collectorName,
    batch,
    dryRun: process.env.DRY_RUN === "true"
  });
});

server.listen(port, () => {
  console.log(`Azure collector listening on :${port}`);
});
