import crypto from "node:crypto";

const AWS_JSON_TARGETS = {
  lambda: {
    service: "lambda",
    target: "ListFunctions",
    version: "20150331",
    namespace: "AWS/Lambda",
    body: {}
  },
  dynamodb: {
    service: "dynamodb",
    target: "DynamoDB_20120810.ListTables",
    namespace: "AWS/DynamoDB",
    body: {}
  },
  rds: {
    service: "rds",
    target: "AmazonRDSv19.DescribeDBInstances",
    namespace: "AWS/RDS",
    body: {}
  },
  sqs: {
    service: "sqs",
    target: "AmazonSQS.ListQueues",
    namespace: "AWS/SQS",
    body: {}
  },
  sns: {
    service: "sns",
    target: "SNS_20100331.ListTopics",
    namespace: "AWS/SNS",
    body: {}
  },
  apigateway: {
    service: "apigateway",
    target: "BackplaneControlService.GetRestApis",
    namespace: "AWS/ApiGateway",
    body: {}
  }
};

const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;
let cachedInventory;
let cachedInventoryKey = "";
let cachedInventoryAt = 0;

const SUPPORTED_DISCOVERY_SERVICES = [
  "s3",
  "lambda",
  "dynamodb",
  "rds",
  "aurora",
  "sqs",
  "sns",
  "apigateway",
  "cloudfront"
];

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function hash(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function dateStamp(amz) {
  return amz.slice(0, 8);
}

async function lambdaCredentials() {
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    };
  }
  const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  if (!relativeUri) {
    throw new Error("AWS credentials are not available to the collector runtime");
  }
  const response = await fetch(`http://169.254.170.2${relativeUri}`);
  if (!response.ok) {
    throw new Error(`Could not load AWS runtime credentials: ${response.status}`);
  }
  const payload = await response.json();
  return {
    accessKeyId: payload.AccessKeyId,
    secretAccessKey: payload.SecretAccessKey,
    sessionToken: payload.Token
  };
}

async function signedJsonPost({ region, service, host, target, body = {} }) {
  const now = amzDate();
  const scopeDate = dateStamp(now);
  const credentials = await lambdaCredentials();
  const payload = JSON.stringify(body);
  const headers = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": now,
    "x-amz-target": target,
    ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {})
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, hash(payload)].join("\n");
  const credentialScope = `${scopeDate}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, credentialScope, hash(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, scopeDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}/`, {
    method: "POST",
    headers: { ...headers, authorization },
    body: payload
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${service} discovery failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function signedQueryGet({ region, service, host, action, params = {} }) {
  const now = amzDate();
  const scopeDate = dateStamp(now);
  const credentials = await lambdaCredentials();
  const search = new URLSearchParams({ Action: action, Version: params.Version, ...params });
  const query = [...search.entries()]
    .filter(([key, value]) => key !== "Version" || value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const headers = {
    host,
    "x-amz-date": now,
    ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {})
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["GET", "/", query, canonicalHeaders, signedHeaders, hash("")].join("\n");
  const credentialScope = `${scopeDate}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, credentialScope, hash(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, scopeDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}/?${query}`, {
    method: "GET",
    headers: { ...headers, authorization }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${service} discovery failed: ${response.status} ${text}`);
  }
  return text;
}

function resourcesFromPayload(service, payload, region) {
  if (service === "lambda") {
    return (payload.Functions || []).map((item) => ({ service: "lambda", serviceFamily: "Lambda", resourceId: item.FunctionArn || item.FunctionName, region }));
  }
  if (service === "dynamodb") {
    return (payload.TableNames || []).map((name) => ({ service: "dynamodb", serviceFamily: "DynamoDB", resourceId: name, region }));
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

async function discoverJsonService(service, region) {
  const config = AWS_JSON_TARGETS[service];
  const host = `${config.service}.${region}.amazonaws.com`;
  const payload = await signedJsonPost({ region, service: config.service, host, target: config.target, body: config.body });
  return resourcesFromPayload(service, payload, region);
}

async function discoverS3(region) {
  const text = await signedQueryGet({ region: "us-east-1", service: "s3", host: "s3.amazonaws.com", action: "ListAllMyBuckets", params: {} });
  const names = [...text.matchAll(/<Name>([^<]+)<\/Name>/g)].map((match) => match[1]);
  return names.map((name) => ({ service: "s3", serviceFamily: "S3", resourceId: name, region: "global" }));
}

async function discoverCloudFront() {
  const text = await signedQueryGet({ region: "us-east-1", service: "cloudfront", host: "cloudfront.amazonaws.com", action: "ListDistributions", params: { Version: "2020-05-31" } });
  const ids = [...text.matchAll(/<Id>([^<]+)<\/Id>/g)].map((match) => match[1]);
  return ids.map((id) => ({ service: "cloudfront", serviceFamily: "CloudFront", resourceId: id, region: "global" }));
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
  if (metricType === "ec2-ebs-summary") return true;
  if (metricType === "dynamodb-summary") return services.has("dynamodb") || discoveryHadError(inventory, "dynamodb");
  if (metricType === "cloudfront-summary") return services.has("cloudfront") || discoveryHadError(inventory, "cloudfront");
  if (metricType === "rds-summary") return services.has("rds") || services.has("aurora") || discoveryHadError(inventory, "rds");
  if (metricType === "queueing-summary") return services.has("sqs") || services.has("sns") || discoveryHadError(inventory, "sqs") || discoveryHadError(inventory, "sns");
  return true;
}

export async function discoverAwsInventory({ regions = [], fetcher, useCache = !fetcher } = {}) {
  const cacheKey = (regions || []).join(",") || process.env.AWS_REGION || "us-east-1";
  if (useCache && cachedInventory && cachedInventoryKey === cacheKey && Date.now() - cachedInventoryAt < DISCOVERY_CACHE_TTL_MS) {
    return cachedInventory;
  }
  const originalFetch = globalThis.fetch;
  if (fetcher) {
    globalThis.fetch = fetcher;
  }
  const regionList = [...new Set((regions.length ? regions : [process.env.AWS_REGION || "us-east-1"])
    .map((region) => String(region || "").trim())
    .filter(Boolean))];
  const resources = [];
  const errors = [];
  try {
    for (const region of regionList) {
      for (const service of ["lambda", "dynamodb", "rds", "sqs", "sns", "apigateway"]) {
        try {
          resources.push(...await discoverJsonService(service, region));
        } catch (error) {
          errors.push({ service, region, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    try {
      resources.push(...await discoverS3(regionList[0]));
    } catch (error) {
      errors.push({ service: "s3", region: "global", message: error instanceof Error ? error.message : String(error) });
    }
    try {
      resources.push(...await discoverCloudFront());
    } catch (error) {
      errors.push({ service: "cloudfront", region: "global", message: error instanceof Error ? error.message : String(error) });
    }
    const inventory = { ...summarize(resources, regionList), errors };
    if (useCache) {
      cachedInventory = inventory;
      cachedInventoryKey = cacheKey;
      cachedInventoryAt = Date.now();
    }
    return inventory;
  } finally {
    if (fetcher) {
      globalThis.fetch = originalFetch;
    }
  }
}

export function collectorRegionsFromEnvironment(value = process.env.COLLECTOR_REGIONS || process.env.AWS_REGION || "") {
  return String(value || "")
    .split(",")
    .map((region) => region.trim())
    .filter(Boolean);
}
