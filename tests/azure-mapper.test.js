import test from "node:test";
import assert from "node:assert/strict";
import { mapAzurePayloadToBatch } from "../apps/azure/mappers.js";

test("maps Azure Function summaries into a CloudSight batch", () => {
  const batch = mapAzurePayloadToBatch({
    metricType: "functions-summary",
    executions: 1400000,
    egressGb: 12,
    timestamp: "2026-05-09T10:00:00Z"
  }, { collectorName: "azure-prod-collector", environment: "Production" });

  assert.equal(batch.provider, "AZURE");
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].inputEndpoint, "functions-execution");
  assert.equal(batch.events[0].outputEndpoint, "bandwidth-egress-gb");
});

test("maps Azure VM summaries into a CloudSight batch", () => {
  const batch = mapAzurePayloadToBatch({
    metricType: "vm-summary",
    coreHours: 18,
    memoryGbHours: 72,
    timestamp: "2026-05-09T10:00:00Z"
  }, { collectorName: "azure-prod-collector", environment: "Production" });

  assert.equal(batch.events[0].inputEndpoint, "vm-core-hour");
  assert.equal(batch.events[0].outputEndpoint, "vm-memory-gb-hour");
});
