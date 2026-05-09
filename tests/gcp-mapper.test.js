import test from "node:test";
import assert from "node:assert/strict";
import { mapGcpPayloadToBatch } from "../apps/gcp/mappers.js";

test("maps GCP Cloud Run summaries into a CloudSight batch", () => {
  const batch = mapGcpPayloadToBatch({
    metricType: "cloud-run-summary",
    requests: 250000,
    vcpuSeconds: 1900,
    timestamp: "2026-05-09T10:00:00Z"
  }, { collectorName: "gcp-prod-collector", environment: "Production" });

  assert.equal(batch.provider, "GCP");
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].inputEndpoint, "cloud-run-request");
  assert.equal(batch.events[0].outputEndpoint, "cloud-run-vcpu-second");
});
