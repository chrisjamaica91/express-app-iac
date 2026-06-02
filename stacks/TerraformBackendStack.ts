import { Construct } from "constructs";
import { TerraformStack, TerraformOutput } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";
import { S3BucketVersioningA } from "@cdktf/provider-aws/lib/s3-bucket-versioning";
import { S3BucketServerSideEncryptionConfigurationA } from "@cdktf/provider-aws/lib/s3-bucket-server-side-encryption-configuration";
import { S3BucketPublicAccessBlock } from "@cdktf/provider-aws/lib/s3-bucket-public-access-block";

export interface TerraformBackendStackConfig {
  awsRegion: string;
  bucketName: string;
  tags: { [key: string]: string };
}

export class TerraformBackendStack extends TerraformStack {
  public readonly bucketName: string;

  constructor(scope: Construct, id: string, config: TerraformBackendStackConfig) {
    super(scope, id);

    new AwsProvider(this, "aws", {
      region: config.awsRegion,
    });

    // S3 bucket for Terraform state (with native locking)
    const stateBucket = new S3Bucket(this, "state-bucket", {
      bucket: config.bucketName,
      tags: {
        ...config.tags,
        Name: config.bucketName,
        Purpose: "Terraform state storage with native locking",
      },
    });

    // Enable versioning (REQUIRED for S3 native locking)
    new S3BucketVersioningA(this, "state-bucket-versioning", {
      bucket: stateBucket.id,
      versioningConfiguration: {
        status: "Enabled",
      },
    });

    // Enable encryption at rest
    new S3BucketServerSideEncryptionConfigurationA(this, "state-bucket-encryption", {
      bucket: stateBucket.id,
      rule: [
        {
          applyServerSideEncryptionByDefault: {
            sseAlgorithm: "AES256",
          },
          bucketKeyEnabled: true,
        },
      ],
    });

    // Block all public access
    new S3BucketPublicAccessBlock(this, "state-bucket-public-access-block", {
      bucket: stateBucket.id,
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });

    this.bucketName = stateBucket.bucket;

    new TerraformOutput(this, "state-bucket-name", {
      value: stateBucket.bucket,
      description: "S3 bucket for Terraform state (with native locking)",
    });
  }
}