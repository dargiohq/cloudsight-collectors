# CloudSight Collectors

CloudSight collectors are the default integration path for clients that want broad cloud coverage without sprinkling direct CloudSight API calls throughout their applications.

## Design

- One collector per provider or environment, not one collector per service
- Shared batch contract for AWS, GCP, Azure, and OpenAI
- Direct `POST /api/usage` remains available as an optional fallback for unsupported workloads or extra safe business context

## Shared contract

Collectors forward batches to:

- `POST /api/collector/events`
- headers:
  - `X-API-KEY`
  - `X-COLLECTOR-NAME`

Batch shape:

```json
{
  "provider": "AWS",
  "collectorName": "aws-prod-collector",
  "mode": "AUTOMATIC",
  "batchReference": "aws-1715232000",
  "events": [
    {
      "service": "AWS",
      "inputEndpoint": "s3-put",
      "outputEndpoint": "s3-get",
      "inputUnits": 1,
      "outputUnits": 0,
      "timestamp": "2026-05-09T10:00:00Z",
      "sourceType": "S3_EVENT",
      "sourceReference": "ObjectCreated:Put",
      "regionCode": "ap-south-1",
      "deploymentEnvironment": "Production",
      "tags": {
        "serviceFamily": "S3",
        "environment": "Production"
      }
    }
  ]
}
```

Only normalized non-PII fields are allowed.

## Apps

- `apps/aws`
  - Lambda/EventBridge oriented collector
- `apps/gcp`
  - Eventarc/Cloud Run oriented collector
- `apps/azure`
  - Event Grid/Azure Functions oriented collector
- `apps/openai-sync`
  - Usage/Costs API sync worker

## Local testing

```bash
cd /Users/saurabhkumar/Documents/project/cloudsight-collectors
npm test
```

## Production env vars

- `CLOUDSIGHT_BASE_URL`
- `CLOUDSIGHT_API_KEY`
- `COLLECTOR_NAME`
- `COLLECTOR_ENVIRONMENT`

Provider-specific helpers:

- AWS:
  - `AWS_REGION`
  - `AWS_ACCOUNT_ID`
- GCP:
  - `GCP_REGION`
  - `GCP_PROJECT_ID`
- Azure:
  - `AZURE_REGION`
  - `AZURE_SUBSCRIPTION_ID`
- OpenAI:
  - `OPENAI_API_KEY`
  - `OPENAI_USAGE_URL` optional override

## Deploy templates

- AWS: `deploy/aws/template.yaml`
- GCP: `deploy/gcp/cloudrun-service.yaml`
- Azure: `deploy/azure/functionapp.bicep`
- OpenAI: `deploy/openai/Dockerfile`
