import test from "node:test";
import assert from "node:assert/strict";
import { discoverAwsInventory } from "../apps/aws/discovery.js";

test("discovery paginates and finds instance-less Aurora clusters across regions", async () => {
  const calls = [];
  const result = await discoverAwsInventory({ regions: ["us-east-1", "ap-south-1"], clientFactory: (service, region) => ({
    send: async command => {
      calls.push([service, region, command.constructor.name, command.input]);
      if (service === "lambda") return command.input.Marker ? { Functions: [{ FunctionName: "second" }] } : { Functions: [{ FunctionName: "first" }], NextMarker: "page2" };
      if (command.constructor.name === "DescribeDBClustersCommand") return { DBClusters: [{ Engine: "aurora-postgresql", DBClusterIdentifier: "serverless" }] };
      return {};
    }, destroy() {}
  }) });
  assert.equal(result.services.lambda, 4);
  assert.equal(result.services.aurora, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(calls.filter(c => c[0] === "s3").length, 1);
});

test("discovery exposes permission failures without declaring empty success", async () => {
  const result = await discoverAwsInventory({ regions: ["us-east-1"], clientFactory: service => ({
    send: async () => { if (service === "dynamodb") throw new Error("AccessDenied"); return {}; }, destroy() {}
  }) });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].service, "dynamodb");
});
