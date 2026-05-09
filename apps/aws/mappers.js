import { buildCollectorBatch, buildCollectorEvent } from "../../shared/contract.js";

function s3RecordToEvent(record, context) {
  return buildCollectorEvent({
    service: "AWS",
    inputEndpoint: "s3-put",
    outputEndpoint: "s3-get",
    inputUnits: 1,
    outputUnits: 0,
    timestamp: record.eventTime || new Date().toISOString(),
    sourceType: "S3_EVENT",
    sourceReference: record.eventName || "ObjectCreated",
    regionCode: record.awsRegion || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: {
      providerAccount: context.accountId || "",
      serviceFamily: "S3",
      environment: context.environment || ""
    }
  });
}

function eventBridgeS3ToEvent(payload, context) {
  return buildCollectorEvent({
    service: "AWS",
    inputEndpoint: "s3-put",
    outputEndpoint: "s3-get",
    inputUnits: 1,
    outputUnits: 0,
    timestamp: payload.time || new Date().toISOString(),
    sourceType: "EVENTBRIDGE",
    sourceReference: payload["detail-type"] || "Object Created",
    regionCode: payload.region || context.regionCode,
    deploymentEnvironment: context.environment,
    tags: {
      providerAccount: payload.account || context.accountId || "",
      serviceFamily: "S3",
      environment: context.environment || ""
    }
  });
}

function metricSummaryToEvent(payload, context) {
  const timestamp = payload.timestamp || new Date().toISOString();
  const regionCode = payload.regionCode || context.regionCode;
  switch (payload.metricType) {
    case "lambda-summary":
      return buildCollectorEvent({
        service: "AWS",
        inputEndpoint: "lambda-request",
        outputEndpoint: "lambda-duration-gb-second",
        inputUnits: Number(payload.invocations || 0),
        outputUnits: Number(payload.gbSeconds || 0),
        timestamp,
        sourceType: "CLOUDWATCH_METRIC",
        sourceReference: "lambda-summary",
        regionCode,
        deploymentEnvironment: context.environment,
        tags: { serviceFamily: "Lambda", environment: context.environment || "" }
      });
    case "api-gateway-summary":
      return buildCollectorEvent({
        service: "AWS",
        inputEndpoint: "api-gateway-request",
        outputEndpoint: "cloudfront-egress-gb",
        inputUnits: Number(payload.requests || 0),
        outputUnits: Number(payload.egressGb || 0),
        timestamp,
        sourceType: "CLOUDWATCH_METRIC",
        sourceReference: "api-gateway-summary",
        regionCode,
        deploymentEnvironment: context.environment,
        tags: { serviceFamily: "API Gateway", environment: context.environment || "" }
      });
    case "dynamodb-summary":
      return buildCollectorEvent({
        service: "AWS",
        inputEndpoint: "dynamodb-read-request-unit",
        outputEndpoint: "dynamodb-write-request-unit",
        inputUnits: Number(payload.readUnits || 0),
        outputUnits: Number(payload.writeUnits || 0),
        timestamp,
        sourceType: "CLOUDWATCH_METRIC",
        sourceReference: "dynamodb-summary",
        regionCode,
        deploymentEnvironment: context.environment,
        tags: { serviceFamily: "DynamoDB", environment: context.environment || "" }
      });
    case "cloudfront-summary":
      return buildCollectorEvent({
        service: "AWS",
        inputEndpoint: "cloudfront-request",
        outputEndpoint: "cloudfront-egress-gb",
        inputUnits: Number(payload.requests || 0),
        outputUnits: Number(payload.egressGb || 0),
        timestamp,
        sourceType: "CLOUDWATCH_METRIC",
        sourceReference: "cloudfront-summary",
        regionCode,
        deploymentEnvironment: context.environment,
        tags: { serviceFamily: "CloudFront", environment: context.environment || "" }
      });
    case "rds-summary":
      return buildCollectorEvent({
        service: "AWS",
        inputEndpoint: "rds-db-instance-hour",
        outputEndpoint: "rds-db-instance-hour",
        inputUnits: Number(payload.instanceHours || 0),
        outputUnits: 0,
        timestamp,
        sourceType: "CLOUDWATCH_METRIC",
        sourceReference: "rds-summary",
        regionCode,
        deploymentEnvironment: context.environment,
        tags: { serviceFamily: "RDS", environment: context.environment || "" }
      });
    default:
      throw new Error(`Unsupported AWS metricType: ${payload.metricType}`);
  }
}

export function mapAwsPayloadToBatch(payload, context = {}) {
  let events = [];

  if (Array.isArray(payload?.Records) && payload.Records[0]?.eventSource === "aws:s3") {
    events = payload.Records.map((record) => s3RecordToEvent(record, context));
  } else if (payload?.source === "aws.s3" || payload?.detail?.bucket?.name || payload?.detail?.requestParameters?.bucketName) {
    events = [eventBridgeS3ToEvent(payload, context)];
  } else if (payload?.metricType) {
    events = [metricSummaryToEvent(payload, context)];
  } else {
    throw new Error("Unsupported AWS payload shape");
  }

  return buildCollectorBatch({
    provider: "AWS",
    collectorName: context.collectorName || "aws-collector",
    mode: context.mode || "AUTOMATIC",
    batchReference: payload.id || payload.batchReference || `aws-${Date.now()}`,
    events
  });
}
