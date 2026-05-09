import test from "node:test";
import assert from "node:assert/strict";
import { mapOpenAiUsagePayloadToBatch } from "../apps/openai-sync/mappers.js";

test("maps OpenAI usage payloads into a CloudSight batch", () => {
  const batch = mapOpenAiUsagePayloadToBatch({
    records: [
      {
        model: "gpt-4.1",
        inputTokens: 12000,
        outputTokens: 3400,
        timestamp: "2026-05-09T10:00:00Z"
      }
    ]
  }, { collectorName: "openai-sync", environment: "Production" });

  assert.equal(batch.provider, "OPENAI");
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].inputEndpoint, "gpt-4.1-input");
  assert.equal(batch.events[0].outputEndpoint, "gpt-4.1-output");
});
