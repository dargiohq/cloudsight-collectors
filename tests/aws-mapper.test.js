import test from "node:test";
import assert from "node:assert/strict";
import { mapAwsPayloadToBatch } from "../apps/aws/mappers.js";

test("maps AWS S3 records into a CloudSight batch", () => {
  const batch = mapAwsPayloadToBatch({
    Records: [
      {
        eventSource: "aws:s3",
        eventTime: "2026-05-09T10:00:00Z",
        eventName: "ObjectCreated:Put",
        awsRegion: "ap-south-1"
      }
    ]
  }, { collectorName: "aws-prod-collector", environment: "Production" });

  assert.equal(batch.provider, "AWS");
  assert.equal(batch.collectorName, "aws-prod-collector");
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].inputEndpoint, "s3-put");
  assert.equal(batch.events[0].outputEndpoint, "s3-get");
});

test("maps AWS queue summaries into a CloudSight batch", () => {
  const batch = mapAwsPayloadToBatch({
    metricType: "queueing-summary",
    sqsRequests: 1200000,
    snsPublishes: 340000,
    timestamp: "2026-05-09T10:00:00Z"
  }, { collectorName: "aws-prod-collector", environment: "Production" });

  assert.equal(batch.events[0].inputEndpoint, "sqs-request");
  assert.equal(batch.events[0].outputEndpoint, "sns-publish-request");
});
