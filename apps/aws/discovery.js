import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { SQSClient, ListQueuesCommand } from "@aws-sdk/client-sqs";
import { SNSClient, ListTopicsCommand } from "@aws-sdk/client-sns";
import { APIGatewayClient, GetRestApisCommand } from "@aws-sdk/client-api-gateway";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, ListDistributionsCommand } from "@aws-sdk/client-cloudfront";

const SUPPORTED_DISCOVERY_SERVICES = ["s3", "lambda", "ec2", "ebs", "dynamodb", "rds", "aurora", "sqs", "sns", "apigateway", "cloudfront"];
const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;
let cachedInventory;
let cachedInventoryKey = "";
let cachedInventoryAt = 0;
const operations = {
  lambda: [LambdaClient, ListFunctionsCommand, "Marker", "NextMarker"],
  ec2: [EC2Client, DescribeInstancesCommand, "NextToken", "NextToken"],
  ebs: [EC2Client, DescribeVolumesCommand, "NextToken", "NextToken"],
  dynamodb: [DynamoDBClient, ListTablesCommand, "ExclusiveStartTableName", "LastEvaluatedTableName"],
  rds: [RDSClient, DescribeDBInstancesCommand, "Marker", "Marker"],
  sqs: [SQSClient, ListQueuesCommand, "NextToken", "NextToken"],
  sns: [SNSClient, ListTopicsCommand, "NextToken", "NextToken"],
  apigateway: [APIGatewayClient, GetRestApisCommand, "position", "position"],
  s3: [S3Client, ListBucketsCommand, "ContinuationToken", "ContinuationToken"],
  cloudfront: [CloudFrontClient, ListDistributionsCommand, "Marker", "NextMarker"]
};

function resourcesFromPayload(service, payload, region) {
  if (service === "lambda") {
    return (payload.Functions || []).map((item) => ({
      service: "lambda",
      serviceFamily: "Lambda",
      resourceId: item.FunctionArn || item.FunctionName,
      region,
      memorySizeMb: Number(item.MemorySize || 128)
    }));
  }
  if (service === "dynamodb") {
    return (payload.TableNames || []).map((name) => ({ service: "dynamodb", serviceFamily: "DynamoDB", resourceId: name, region }));
  }
  if (service === "ec2") {
    return (payload.Reservations || []).flatMap((reservation) => (reservation.Instances || []))
      .filter((item) => !["shutting-down", "terminated"].includes(String(item.State?.Name || "").toLowerCase()))
      .map((item) => {
        const coreCount = Number(item.CpuOptions?.CoreCount || 0);
        const threadsPerCore = Number(item.CpuOptions?.ThreadsPerCore || 0);
        const vcpus = coreCount > 0 && threadsPerCore > 0 ? coreCount * threadsPerCore : 1;
        return {
          service: "ec2",
          serviceFamily: "EC2",
          resourceId: item.InstanceId,
          region,
          instanceType: item.InstanceType,
          state: item.State?.Name || "unknown",
          vcpus
        };
      });
  }
  if (service === "ebs") {
    return (payload.Volumes || [])
      .filter((item) => !["deleted", "deleting"].includes(String(item.State || "").toLowerCase()))
      .map((item) => ({
        service: "ebs",
        serviceFamily: "EBS",
        resourceId: item.VolumeId,
        region,
        volumeType: item.VolumeType || "gp3",
        sizeGiB: Number(item.Size || 0)
      }));
  }
  if (service === "rds") {
    return (payload.DBInstances || []).map((item) => {
      const engine = String(item.Engine || "").toLowerCase();
      const isAurora = engine.includes("aurora");
      return {
        service: isAurora ? "aurora" : "rds",
        serviceFamily: isAurora ? "Aurora" : "RDS",
        resourceId: item.DBInstanceArn || item.DBInstanceIdentifier,
        region,
        engine: item.Engine || "rds"
      };
    });
  }
  if (service === "sqs") {
    return (payload.QueueUrls || []).map((url) => ({ service: "sqs", serviceFamily: "SQS", resourceId: url, region }));
  }
  if (service === "sns") {
    return (payload.Topics || []).map((item) => ({ service: "sns", serviceFamily: "SNS", resourceId: item.TopicArn, region }));
  }
  if (service === "apigateway") {
    return (payload.items || payload.Items || []).map((item) => ({ service: "apigateway", serviceFamily: "API Gateway", resourceId: item.id || item.name, region }));
  }
  return [];
}

function summarize(resources, regions) {
  const serviceCounts = Object.fromEntries(SUPPORTED_DISCOVERY_SERVICES.map((service) => [service, 0]));
  for (const resource of resources) {
    serviceCounts[resource.service] = (serviceCounts[resource.service] || 0) + 1;
  }
  return {
    discoveredAt: new Date().toISOString(),
    regions,
    services: serviceCounts,
    resources
  };
}

export function discoveredServicesFromInventory(inventory = {}) {
  return new Set(Object.entries(inventory.services || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([service]) => service));
}

function discoveryHadError(inventory, service) {
  return (inventory?.errors || []).some((error) => error.service === service);
}

export function shouldRunMetricModule(metricType, inventory) {
  if (!inventory) {
    return true;
  }
  const services = discoveredServicesFromInventory(inventory);
  if (metricType === "lambda-summary") return services.has("lambda") || discoveryHadError(inventory, "lambda");
  if (metricType === "api-gateway-summary") return services.has("apigateway") || discoveryHadError(inventory, "apigateway");
  if (metricType === "ec2-ebs-summary") return services.has("ec2") || services.has("ebs") || discoveryHadError(inventory, "ec2") || discoveryHadError(inventory, "ebs");
  if (metricType === "dynamodb-summary") return services.has("dynamodb") || discoveryHadError(inventory, "dynamodb");
  if (metricType === "cloudfront-summary") return services.has("cloudfront") || discoveryHadError(inventory, "cloudfront");
  if (metricType === "rds-summary") return services.has("rds") || services.has("aurora") || discoveryHadError(inventory, "rds");
  if (metricType === "queueing-summary") return services.has("sqs") || services.has("sns") || discoveryHadError(inventory, "sqs") || discoveryHadError(inventory, "sns");
  return true;
}

export async function discoverAwsInventory({ regions = [], clientFactory, useCache = !clientFactory } = {}) {
  const regionList = [...new Set((regions.length ? regions : [process.env.AWS_REGION || "us-east-1"]).map(r => String(r).trim()).filter(Boolean))];
  const cacheKey = regionList.join(",");
  if (useCache && cachedInventory && cachedInventoryKey === cacheKey && Date.now() - cachedInventoryAt < DISCOVERY_CACHE_TTL_MS) return cachedInventory;
  const resources = [];
  const errors = [];
  for (const [service, [Client, Command, requestToken, responseToken]] of Object.entries(operations)) {
    const serviceRegions = ["s3", "cloudfront"].includes(service) ? ["us-east-1"] : regionList;
    for (const region of serviceRegions) {
      const client = clientFactory ? clientFactory(service, region) : new Client({ region, maxAttempts: 2 });
      try {
        let token;
        const seenTokens = new Set();
        do {
          const input = { ...(token ? { [requestToken]: token } : {}), ...(service === "sqs" ? { MaxResults: 1000 } : {}) };
          const payload = await client.send(new Command(input));
          if (service === "s3") {
            resources.push(...(payload.Buckets || []).map(b => ({ service, serviceFamily: "S3", resourceId: b.Name, region: b.BucketRegion || "global" })));
          } else if (service === "cloudfront") {
            resources.push(...(payload.DistributionList?.Items || []).map(d => ({ service, serviceFamily: "CloudFront", resourceId: d.Id, region: "global" })));
          } else {
            resources.push(...resourcesFromPayload(service, payload, region));
          }
          token = service === "cloudfront" ? payload.DistributionList?.NextMarker : payload[responseToken];
          if (token && seenTokens.has(token)) throw new Error("Repeated pagination token from AWS");
          if (token) seenTokens.add(token);
        } while (token);
        // Clusters without instances (including serverless Aurora) must also be visible.
        if (service === "rds") {
          let marker;
          const seen = new Set();
          do {
            const page = await client.send(new DescribeDBClustersCommand(marker ? { Marker: marker } : {}));
            resources.push(...(page.DBClusters || []).map(c => ({ service: String(c.Engine).includes("aurora") ? "aurora" : "rds", serviceFamily: String(c.Engine).includes("aurora") ? "Aurora" : "RDS", resourceId: c.DBClusterArn || c.DBClusterIdentifier, region, engine: c.Engine })));
            marker = page.Marker;
            if (marker && seen.has(marker)) throw new Error("Repeated RDS pagination token");
            if (marker) seen.add(marker);
          } while (marker);
        }
      } catch (error) {
        errors.push({ service, region, message: error.message });
      } finally {
        client.destroy?.();
      }
    }
  }
  const inventory = { ...summarize(resources, regionList), errors };
  if (useCache && !errors.length) {
    cachedInventory = inventory;
    cachedInventoryKey = cacheKey;
    cachedInventoryAt = Date.now();
  }
  return inventory;
}

export function collectorRegionsFromEnvironment(value = process.env.COLLECTOR_REGIONS || process.env.AWS_REGION || "") {
  return String(value || "")
    .split(",")
    .map((region) => region.trim())
    .filter(Boolean);
}
