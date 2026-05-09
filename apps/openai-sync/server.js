import { createJsonServer } from "../../shared/http.js";
import { mapOpenAiUsagePayloadToBatch } from "./mappers.js";
import { postCollectorBatch } from "../../shared/cloudsight-client.js";

const port = Number(process.env.PORT || 9096);

const server = createJsonServer(async ({ body }) => {
  const batch = mapOpenAiUsagePayloadToBatch(body, {
    collectorName: process.env.COLLECTOR_NAME || "openai-sync",
    environment: process.env.COLLECTOR_ENVIRONMENT || "Production",
    mode: "AUTOMATIC"
  });
  return postCollectorBatch({
    collectorName: batch.collectorName,
    batch,
    dryRun: process.env.DRY_RUN === "true"
  });
});

server.listen(port, () => {
  console.log(`OpenAI sync collector listening on :${port}`);
});
