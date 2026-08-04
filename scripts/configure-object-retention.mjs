import assert from 'node:assert/strict';
import { PutBucketLifecycleConfigurationCommand, PutBucketVersioningCommand, S3Client } from '@aws-sdk/client-s3';
import { assertObjectRetention, auditObjectRetention, normalizeBackupConfig } from './backup-production.mjs';

const targetHost = 'annotated-staging.up.railway.app';

export const normalizeIncompleteUploadDays = (value = process.env.OBJECT_RETENTION_INCOMPLETE_UPLOAD_DAYS || 7) => {
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('OBJECT_RETENTION_INCOMPLETE_UPLOAD_DAYS must be an integer between 1 and 365.');
  return days;
};

export const retentionConfiguration = ({ incompleteUploadDays = normalizeIncompleteUploadDays() } = {}) => ({
  versioning: { Status: 'Enabled' },
  lifecycle: {
    Rules: [{
      ID: 'annotated-incomplete-upload-cleanup',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: incompleteUploadDays },
    }],
  },
});

export const applyObjectRetention = async ({ client, bucket, incompleteUploadDays } = {}) => {
  if (!client || !bucket) throw new Error('An S3 client and bucket are required.');
  const configuration = retentionConfiguration({ incompleteUploadDays });
  await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: configuration.versioning }));
  await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: configuration.lifecycle }));
  const retention = await auditObjectRetention({ client, bucket });
  assertObjectRetention({ retention, requireVersioning: true, requireLifecycle: true });
  return { retention, incompleteUploadDays: configuration.lifecycle.Rules[0].AbortIncompleteMultipartUpload.DaysAfterInitiation };
};

export const describeRetentionProviderError = (error) => {
  const code = error?.Code || error?.name;
  if (code === 'BucketAlreadyExists' && error?.$metadata?.httpStatusCode === 409) return 'The configured S3 provider does not expose bucket versioning through PutBucketVersioning; it interpreted the request as a bucket-creation attempt.';
  if (code === 'InvalidRequest' && /lifecycle only supports expiration/i.test(String(error?.message || ''))) return 'The configured S3 provider only accepts expiration lifecycle rules; incomplete multipart-upload cleanup is unavailable.';
  return String(error?.message || 'The object-retention provider request failed.');
};

const createClient = (config) => new S3Client({
  region: config.region,
  endpoint: config.endpoint,
  forcePathStyle: config.forcePathStyle,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
});

const run = async () => {
  if (process.env.APPLY_OBJECT_RETENTION !== '1') throw new Error('Set APPLY_OBJECT_RETENTION=1 to change the guarded staging bucket policy.');
  assert.equal(process.env.NODE_ENV, 'production', 'Object retention must run in production mode.');
  const origin = new URL(process.env.PUBLIC_ORIGIN || '');
  assert.equal(origin.hostname, targetHost, `Object retention is restricted to ${targetHost}.`);
  const config = normalizeBackupConfig();
  const result = await applyObjectRetention({ client: createClient(config), bucket: config.bucket });
  console.log(JSON.stringify({ status: 'configured', bucket: config.bucket, ...result }, null, 2));
};

const isMainModule = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMainModule) run().catch((error) => { console.error(`Object retention configuration failed: ${describeRetentionProviderError(error)}`); process.exitCode = 1; });
