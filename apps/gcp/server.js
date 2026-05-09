import { createJsonServer } from "../../shared/http.js";
import { postCollectorBatch } from "../../shared/cloudsight-client.js";
import { mapGcpPayloadToBatch } from "./mappers.js";

const port = Number(process.env.PORT || 9094);

const server = createJsonServer(async ({ body }) => {
  const batch = mapGcpPayloadToBatch(body, {
    collectorName: process.env.COLLECTOR_NAME || "gcp-collector",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    regionCode: process.env.GCP_REGION || body.regionCode,
    project: process.env.GCP_PROJECT_ID,
    mode: "AUTOMATIC"
  });
  return postCollectorBatch({
    collectorName: batch.collectorName,
    batch,
    dryRun: process.env.DRY_RUN === "true"
  });
});

server.listen(port, () => {
  console.log(`GCP collector listening on :${port}`);
});
