# AWS validation status — 5 October 2026

## Verified live on 3 October

- Existing IAM test identity authenticated successfully.
- Actual onboarding-generated CloudFormation template validated and deployed.
- Temporary S3 object event traversed EventBridge and Lambda into CloudSight.
- Collector-authenticated readback returned a persisted, priced S3 event.
- Stack, bucket, objects and temporary CloudSight collector were deleted.
- Evidence: oracle-cloudsight-stack/run/aws-collector-live-e2e-20261003103234.json.

## Fixes made during validation

- Replaced invalid hand-written discovery protocols with official AWS SDK clients.
- Added pagination, regional inventory, instance-less Aurora cluster discovery and explicit permission errors.
- Added EC2 and EBS discovery so instance-hours and GP3 storage-month estimates come from discovered resources instead of unrelated CloudWatch counters.
- Changed RDS/Aurora metering to derive database resource-hours from discovery inventory instead of CPU utilization.
- Lambda GB-second normalization now accounts for invocation count and discovered configured memory when the collector can read it.
- AWS Docker build now installs locked SDK dependencies.
- Backend pricing readiness no longer marks partial or unknown coverage client-ready.
- Database integration test verifies signed billing amounts and repeat invoice imports without duplicate lines.

## Still blocked or incomplete

- Live inventory requests now reach the correct APIs, but the test IAM user lacks read permissions.
- Live Cost Explorer/CUR billing totals have not been reconciled with an actual provider bill.
- Onboarding and Connections generate different deployment artifacts. Onboarding is S3-only; Connections uses a SAM artifact requiring collector source packaging.
- Broader metric conversion is improved but not bill-perfect: EC2, EBS, RDS, and Lambda now use discovery-informed units, while provider invoice reconciliation is still required for final customer billing accuracy.
- CSV and gzip CUR import exists; Parquet is not supported.
- No claim of universal AWS coverage or production billing accuracy is justified by the S3 test.

## Cleanup exception

The IAM test user cannot delete this test-created log group:

`/aws/lambda/cloudsight-e2e-2026100310-CloudSightCollectorFunct-cD7vdOr6gRWa`

Only this log group needs cleanup; do not delete unrelated resources. Actual AWS charges are not verified because billing reads are not authorized. Test consisted of a short-lived Lambda/EventBridge/S3 deployment, with no database or VM creation.
