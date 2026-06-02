import { Construct } from "constructs";
import { S3Backend, TerraformStack } from "cdktf";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment";
import { IamPolicy } from "@cdktf/provider-aws/lib/iam-policy";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";

export interface IamStackConfig {
  environment: string;
  appName: string;
  awsAccountId: string;
  awsRegion: string;
  ecrRepositoryName: string;
  tags: { [key: string]: string };
}

export interface IamStackOutputs {
  taskExecutionRoleArn: string;
  taskRoleArn: string;
}

export class IamStack extends TerraformStack {
  public readonly taskExecutionRoleArn: string;
  public readonly taskRoleArn: string;

  constructor(scope: Construct, id: string, config: IamStackConfig) {
    super(scope, id);

    // Add AWS Provider
    new AwsProvider(this, "aws", {
      region: config.awsRegion,
    });

    // Add S3Backend
    new S3Backend(this, {
      bucket: `express-app-tfstate-${config.awsAccountId}`,
      key: `${config.environment}/iam/terraform.tfstate`, // Environment-specific
      region: config.awsRegion,
      encrypt: true,
    });

    // ===== Task Execution Role =====
    // Used by ECS agent to pull images and write logs
    
    const taskExecutionRole = new IamRole(this, "task-execution-role", {
      name: `${config.appName}-${config.environment}-task-execution-role`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      tags: {
        ...config.tags,
        Name: `${config.appName}-${config.environment}-task-execution-role`,
      },
    });

    // Attach AWS managed policy for ECS task execution
    new IamRolePolicyAttachment(this, "task-execution-policy-attachment", {
      role: taskExecutionRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    });

    // Additional policy for ECR image scanning and CloudWatch Logs
    const taskExecutionPolicy = new IamPolicy(this, "task-execution-policy", {
      name: `${config.appName}-${config.environment}-task-execution-policy`,
      description: "Additional permissions for ECS task execution",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "ecr:GetAuthorizationToken",
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetDownloadUrlForLayer",
              "ecr:BatchGetImage",
            ],
            Resource: `arn:aws:ecr:${config.awsRegion}:${config.awsAccountId}:repository/${config.ecrRepositoryName}`,
          },
          {
            Effect: "Allow",
            Action: [
              "ecr:GetAuthorizationToken",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: [
              "logs:CreateLogStream",
              "logs:PutLogEvents",
            ],
            Resource: `arn:aws:logs:${config.awsRegion}:${config.awsAccountId}:log-group:/ecs/${config.appName}-${config.environment}:*`,
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "task-execution-custom-policy-attachment", {
      role: taskExecutionRole.name,
      policyArn: taskExecutionPolicy.arn,
    });

    // ===== Task Role =====
    // Used by application code running in the container
    
    const taskRole = new IamRole(this, "task-role", {
      name: `${config.appName}-${config.environment}-task-role`,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "ecs-tasks.amazonaws.com",
            },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      tags: {
        ...config.tags,
        Name: `${config.appName}-${config.environment}-task-role`,
      },
    });

    // Application-specific permissions
    // For now, minimal permissions - expand as needed
    const taskPolicy = new IamPolicy(this, "task-policy", {
      name: `${config.appName}-${config.environment}-task-policy`,
      description: "Permissions for application code",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
            ],
            Resource: `arn:aws:logs:${config.awsRegion}:${config.awsAccountId}:log-group:/ecs/${config.appName}-${config.environment}:*`,
          },
          // Add more permissions as your app needs:
          // - S3 access: s3:GetObject, s3:PutObject
          // - DynamoDB: dynamodb:GetItem, dynamodb:PutItem
          // - SQS: sqs:SendMessage, sqs:ReceiveMessage
          // - Secrets Manager: secretsmanager:GetSecretValue
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "task-policy-attachment", {
      role: taskRole.name,
      policyArn: taskPolicy.arn,
    });

    // Store outputs
    this.taskExecutionRoleArn = taskExecutionRole.arn;
    this.taskRoleArn = taskRole.arn;
  }
}