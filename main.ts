import * as dotenv from "dotenv";
// Load environment variables
dotenv.config();

import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput, S3Backend } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { VpcConstruct } from "./constructs/VpcConstruct";
import { EcrConstruct } from "./constructs/EcrConstruct";
import { AlbConstruct } from "./constructs/AlbConstruct";
import { EcsConstruct } from "./constructs/EcsConstruct";
import { IamStack } from "./stacks/IamStack";
import { getConfig } from "./config";
import { GithubOidcStack } from "./stacks/GithubOidcStack";
import { TerraformBackendStack } from "./stacks/TerraformBackendStack";

// Load config (now .env is already loaded)
const config = getConfig(process.env.ENVIRONMENT || "dev");

const app = new App();

// Create the backend bucket FIRST (before other stacks reference it)
new TerraformBackendStack(app, "terraform-backend", {
  awsRegion: config.awsRegion,
  bucketName: `express-app-tfstate-${config.awsAccountId}`,
  tags: config.tags,
});

// the trust policy is configured to allow GitHub's OIDC provider to assume this role, but only for the specified organization and repositories. This ensures that only workflows from the allowed repos can authenticate and deploy infrastructure changes.
const githubOidcStack = new GithubOidcStack(app, "github-oidc", {
  awsRegion: config.awsRegion,
  awsAccountId: config.awsAccountId,
  githubOrg: config.githubOrg,
  githubRepos: ["express-app", "express-app-iac"],
  tags: config.tags,
});

const iamStack = new IamStack(app, `express-app-iam-${config.environment}`, {
  environment: config.environment,
  appName: "express-app",
  awsAccountId: config.awsAccountId,
  awsRegion: config.awsRegion,
  ecrRepositoryName: config.ecr.repositoryName,
  tags: config.tags,
});

class ExpressAppStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Configure AWS Provider
    new AwsProvider(this, "aws", {
      region: config.awsRegion,
    });

    // Configure S3 backend with native locking
    new S3Backend(this, {
      bucket: `express-app-tfstate-${config.awsAccountId}`,
      key: `${config.environment}/express-app-iac/terraform.tfstate`,
      region: config.awsRegion,
      encrypt: true,
    });

    const envPrefix = `${config.app.name}-${config.environment}`;

    // Create VPC
    const vpc = new VpcConstruct(this, "vpc", {
      cidr: config.vpc.cidr,
      azCount: config.vpc.azCount,
      tags: config.tags,
    });

    // ECR repository - only create in dev, reference existing in staging/prod
    let ecrRepositoryUrl: string;
    let ecrRepositoryArn: string;
    let ecrRepositoryName: string;

    if (config.environment === "dev") {
      // Create ECR repository only in dev environment
      const ecr = new EcrConstruct(this, "ecr", {
        repositoryName: config.ecr.repositoryName,
        imageTagMutability: config.ecr.imageTagMutability,
        tags: config.tags,
      });
      ecrRepositoryUrl = ecr.outputs.repositoryUrl;
      ecrRepositoryArn = ecr.outputs.repositoryArn;
      ecrRepositoryName = ecr.outputs.repositoryName;
    } else {
      // For staging/prod, reference the existing ECR repository created in dev
<<<<<<< Updated upstream
      const {
        DataAwsEcrRepository,
      } = require("@cdktf/provider-aws/lib/data-aws-ecr-repository");
=======
      const { DataAwsEcrRepository } = require("@cdktf/provider-aws/lib/data-aws-ecr-repository");
>>>>>>> Stashed changes
      const existingEcr = new DataAwsEcrRepository(this, "ecr-data", {
        name: config.ecr.repositoryName,
      });
      ecrRepositoryUrl = existingEcr.repositoryUrl;
      ecrRepositoryArn = existingEcr.arn;
      ecrRepositoryName = existingEcr.name;
    }

    // Create ALB
    const alb = new AlbConstruct(this, "alb", {
      name: `${envPrefix}-alb`,
      vpcId: vpc.outputs.vpcId,
      publicSubnetIds: vpc.outputs.publicSubnetIds,
      securityGroupIds: [vpc.outputs.albSecurityGroupId],
      targetPort: 3000,
      healthCheckPath: "/health",
      tags: config.tags,
    });

    // Create ECS cluster and service
    const ecs = new EcsConstruct(this, "ecs", {
      clusterName: `${envPrefix}-cluster`,
      serviceName: `${envPrefix}-service`,
      taskFamily: `${envPrefix}-task`,
      cpu: config.ecs.cpu,
      memory: config.ecs.memory,
      desiredCount: config.ecs.desiredCount,
      containerImage: `${ecrRepositoryUrl}:${config.environment}`,
      containerPort: 3000,
      taskRoleArn: iamStack.taskRoleArn,
      executionRoleArn: iamStack.taskExecutionRoleArn,
      securityGroupIds: [vpc.outputs.ecsSecurityGroupId],
      subnetIds: vpc.outputs.privateSubnetIds,
      targetGroupArn: alb.outputs.targetGroupArn,
      tags: config.tags,
    });

    // Outputs
    new TerraformOutput(this, "environment", {
      value: config.environment,
    });

    new TerraformOutput(this, "aws-region", {
      value: config.awsRegion,
    });

    new TerraformOutput(this, "vpc-id", {
      value: vpc.outputs.vpcId,
    });

    new TerraformOutput(this, "ecr-repository-url", {
      value: ecrRepositoryUrl,
    });

    new TerraformOutput(this, "alb-dns-name", {
      value: alb.outputs.albDnsName,
      description:
        "Load balancer DNS name - use this to access the application",
    });

    new TerraformOutput(this, "ecs-cluster-name", {
      value: ecs.outputs.clusterName,
    });

    new TerraformOutput(this, "ecs-service-name", {
      value: ecs.outputs.serviceName,
    });

    new TerraformOutput(this, "public-subnet-ids", {
      value: vpc.outputs.publicSubnetIds,
    });

    new TerraformOutput(this, "private-subnet-ids", {
      value: vpc.outputs.privateSubnetIds,
    });

    new TerraformOutput(this, "alb-security-group-id", {
      value: vpc.outputs.albSecurityGroupId,
    });

    new TerraformOutput(this, "ecs-security-group-id", {
      value: vpc.outputs.ecsSecurityGroupId,
    });
  }
}

new ExpressAppStack(app, `express-app-iac-${config.environment}`);
app.synth();
