import crypto from "node:crypto";

const METRIC_QUERIES = {
  "lambda-summary": [
    { id: "invocations", expression: "SUM(SEARCH('{AWS/Lambda,FunctionName} MetricName=\"Invocations\"', 'Sum', 300))" },
    { id: "durationMs", expression: "SUM(SEARCH('{AWS/Lambda,FunctionName} MetricName=\"Duration\"', 'Average', 300))" }
  ],
  "api-gateway-summary": [
    { id: "requests", expression: "SUM(SEARCH('{AWS/ApiGateway,ApiName,Stage,Method,Resource} MetricName=\"Count\"', 'Sum', 300))" }
  ],
  "ec2-ebs-summary": [],
  "dynamodb-summary": [
    { id: "readUnits", expression: "SUM(SEARCH('{AWS/DynamoDB,TableName} MetricName=\"ConsumedReadCapacityUnits\"', 'Sum', 300))" },
    { id: "writeUnits", expression: "SUM(SEARCH('{AWS/DynamoDB,TableName} MetricName=\"ConsumedWriteCapacityUnits\"', 'Sum', 300))" }
  ],
  "cloudfront-summary": [
    { id: "requests", expression: "SUM(SEARCH('{AWS/CloudFront,DistributionId,Region} MetricName=\"Requests\"', 'Sum', 300))" },
    { id: "egressGb", expression: "SUM(SEARCH('{AWS/CloudFront,DistributionId,Region} MetricName=\"BytesDownloaded\"', 'Sum', 300))" }
  ],
  "rds-summary": [],
  "queueing-summary": [
    { id: "sqsRequests", expression: "SUM(SEARCH('{AWS/SQS,QueueName} MetricName=\"NumberOfMessagesSent\"', 'Sum', 300))" },
    { id: "snsPublishes", expression: "SUM(SEARCH('{AWS/SNS,TopicName} MetricName=\"NumberOfMessagesPublished\"', 'Sum', 300))" }
  ]
};

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

async function signedCloudWatchPost(region, body) {
  const service = "monitoring";
  const host = `monitoring.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const now = amzDate();
  const scopeDate = dateStamp(now);
  const credentials = await lambdaCredentials();
  const payload = JSON.stringify(body);
  const headers = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": now,
    "x-amz-target": "GraniteServiceVersion20100801.GetMetricData",
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, authorization },
    body: payload
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`CloudWatch GetMetricData failed: ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

function latestValue(payload, id) {
  const result = (payload.MetricDataResults || []).find((item) => item.Id === id);
  const values = result?.Values || [];
  const value = values.length ? Number(values[0]) : 0;
  return Number.isFinite(value) ? value : 0;
}

function collectionWindowHours(event) {
  const minutes = Number(event.windowMinutes || process.env.CLOUDSIGHT_METRIC_WINDOW_MINUTES || 5);
  return Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 5 / 60;
}

function collectionWindowMonthFraction(event) {
  return collectionWindowHours(event) / (24 * 30);
}

function resourcesFor(inventory, service) {
  return (inventory?.resources || []).filter((resource) => resource.service === service);
}

function sumNumbers(items, field) {
  return items.reduce((sum, item) => {
    const value = Number(item?.[field] || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function averageLambdaMemoryGb(inventory) {
  const lambdas = resourcesFor(inventory, "lambda");
  if (!lambdas.length) return 0.125;
  const memoryMb = sumNumbers(lambdas, "memorySizeMb") / lambdas.length;
  return Math.max(memoryMb || 128, 128) / 1024;
}

export async function enrichAwsMetricSummary(event, context = {}) {
  const metricType = event?.metricType;
  const queries = METRIC_QUERIES[metricType];
  if (!queries) {
    return event;
  }
  if (metricType === "ec2-ebs-summary") {
    const inventory = event.discoveryInventory || {};
    const coreHours = sumNumbers(resourcesFor(inventory, "ec2"), "vcpus") * collectionWindowHours(event);
    const gp3GbMonth = resourcesFor(inventory, "ebs")
      .filter((volume) => String(volume.volumeType || "gp3").toLowerCase() === "gp3")
      .reduce((sum, volume) => sum + Number(volume.sizeGiB || 0), 0) * collectionWindowMonthFraction(event);
    return { ...event, coreHours, gp3GbMonth };
  }
  if (metricType === "rds-summary") {
    const inventory = event.discoveryInventory || {};
    const services = inventory.services || {};
    const databaseResources = [
      ...resourcesFor(inventory, "rds"),
      ...resourcesFor(inventory, "aurora")
    ];
    return {
      ...event,
      instanceHours: databaseResources.length * collectionWindowHours(event),
      hasAurora: Number(services.aurora || 0) > 0
    };
  }
  const region = event.regionCode || context.regionCode || process.env.AWS_REGION || "us-east-1";
  const end = new Date();
  const start = new Date(end.getTime() - 5 * 60 * 1000);
  const payload = await signedCloudWatchPost(region === "global" ? "us-east-1" : region, {
    StartTime: start.toISOString(),
    EndTime: end.toISOString(),
    ScanBy: "TimestampDescending",
    MetricDataQueries: queries.map((query) => ({
      Id: query.id,
      Expression: query.expression,
      ReturnData: true,
      Period: 300
    }))
  });

  if (metricType === "lambda-summary") {
    const invocations = latestValue(payload, "invocations");
    const averageDurationMs = latestValue(payload, "durationMs");
    const memoryGb = averageLambdaMemoryGb(event.discoveryInventory);
    return { ...event, invocations, gbSeconds: (averageDurationMs * invocations * memoryGb) / 1000 };
  }
  if (metricType === "api-gateway-summary") {
    return { ...event, requests: latestValue(payload, "requests"), egressGb: 0 };
  }
  if (metricType === "dynamodb-summary") {
    return { ...event, readUnits: latestValue(payload, "readUnits"), writeUnits: latestValue(payload, "writeUnits") };
  }
  if (metricType === "cloudfront-summary") {
    return { ...event, requests: latestValue(payload, "requests"), egressGb: latestValue(payload, "egressGb") / (1024 ** 3) };
  }
  if (metricType === "queueing-summary") {
    return { ...event, sqsRequests: latestValue(payload, "sqsRequests"), snsPublishes: latestValue(payload, "snsPublishes") };
  }
  return event;
}
