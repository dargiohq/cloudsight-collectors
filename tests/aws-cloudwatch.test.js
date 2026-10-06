import test from "node:test";
import assert from "node:assert/strict";
import { enrichAwsMetricSummary } from "../apps/aws/cloudwatch.js";

test("EC2 and EBS summary uses discovered resources instead of utilization counters", async () => {
  const event = await enrichAwsMetricSummary({
    metricType: "ec2-ebs-summary",
    windowMinutes: 60,
    discoveryInventory: {
      resources: [
        { service: "ec2", vcpus: 2 },
        { service: "ec2", vcpus: 4 },
        { service: "ebs", volumeType: "gp3", sizeGiB: 300 },
        { service: "ebs", volumeType: "io2", sizeGiB: 100 }
      ]
    }
  });

  assert.equal(event.coreHours, 6);
  assert.equal(event.gp3GbMonth, 300 / (24 * 30));
});

test("RDS summary uses discovered database resource-hours and preserves Aurora signal", async () => {
  const event = await enrichAwsMetricSummary({
    metricType: "rds-summary",
    windowMinutes: 30,
    discoveryInventory: {
      services: { aurora: 1, rds: 1 },
      resources: [
        { service: "rds" },
        { service: "aurora" }
      ]
    }
  });

  assert.equal(event.instanceHours, 1);
  assert.equal(event.hasAurora, true);
});
