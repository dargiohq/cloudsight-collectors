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

import { shouldRunMetricModule } from "../apps/aws/discovery.js";

test("AWS discovery runs the Aurora/RDS module when Aurora is discovered", () => {
  const inventory = {
    services: { aurora: 1, rds: 0, dynamodb: 0 },
    errors: []
  };

  assert.equal(shouldRunMetricModule("rds-summary", inventory), true);
  assert.equal(shouldRunMetricModule("dynamodb-summary", inventory), false);
});

test("AWS discovery does not skip a module when discovery had an AWS permission error", () => {
  const inventory = {
    services: { dynamodb: 0 },
    errors: [{ service: "dynamodb", region: "us-east-1", message: "AccessDenied" }]
  };

  assert.equal(shouldRunMetricModule("dynamodb-summary", inventory), true);
});

test("maps Aurora-discovered RDS summaries without changing the CloudSight event contract", () => {
  const batch = mapAwsPayloadToBatch({
    metricType: "rds-summary",
    instanceHours: 2,
    hasAurora: true,
    timestamp: "2026-05-09T10:00:00Z",
    discoveryInventory: { services: { aurora: 1 } }
  }, { collectorName: "aws-prod-collector", environment: "Production", accountId: "prod-account" });

  assert.equal(batch.events[0].inputEndpoint, "rds-db-instance-hour");
  assert.equal(batch.events[0].sourceReference, "aurora-summary");
  assert.equal(batch.events[0].tags.serviceFamily, "Aurora");
  assert.equal(batch.events[0].tags.providerAccount, "prod-account");
});
