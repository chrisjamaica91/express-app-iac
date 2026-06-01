import { Construct } from "constructs";
import { TerraformStack, TerraformOutput } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { IamOpenidConnectProvider } from "@cdktf/provider-aws/lib/iam-openid-connect-provider";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment";
import { IamPolicy } from "@cdktf/provider-aws/lib/iam-policy";

export interface GithubOidcStackConfig {
  awsRegion: string;
  awsAccountId: string;
  githubOrg: string; // Your GitHub username or org
  githubRepos: string[]; // ["express-app", "express-app-iac"]
  tags: { [key: string]: string };
}

export class GithubOidcStack extends TerraformStack {
  public readonly githubActionsRoleArn: string;

  constructor(scope: Construct, id: string, config: GithubOidcStackConfig) {
    super(scope, id);

    new AwsProvider(this, "aws", {
      region: config.awsRegion,
    });

    // Create OIDC Provider for GitHub Actions
    const oidcProvider = new IamOpenidConnectProvider(this, "github-oidc-provider", {
      url: "https://token.actions.githubusercontent.com",
      clientIdList: ["sts.amazonaws.com"],
      thumbprintList: [
        "6938fd4d98bab03faadb97b34396831e3780aea1", // GitHub Actions thumbprint (2024+)
        "1c58a3a8518e8759bf075b76b750d4f2df264fcd", // Backup thumbprint
      ],
      tags: {
        ...config.tags,
        Name: "github-actions-oidc-provider",
      },
    });

    // Create IAM role for GitHub Actions
    const githubActionsRole = new IamRole(this, "github-actions-role", {
      name: "github-actions-deployment-role",
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Federated: oidcProvider.arn,
            },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              },
              StringLike: {
                // Allow all repos in your org, or specific repos
                "token.actions.githubusercontent.com:sub": config.githubRepos.map(
                  (repo) => `repo:${config.githubOrg}/${repo}:*`
                ),
              },
            },
          },
        ],
      }),
      tags: {
        ...config.tags,
        Name: "github-actions-deployment-role",
      },
    });

    // Policy for ECR access (push images)
    const ecrPolicy = new IamPolicy(this, "ecr-policy", {
      name: "github-actions-ecr-policy",
      description: "Allow GitHub Actions to push to ECR",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
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
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetDownloadUrlForLayer",
              "ecr:BatchGetImage",
              "ecr:PutImage",
              "ecr:InitiateLayerUpload",
              "ecr:UploadLayerPart",
              "ecr:CompleteLayerUpload",
              "ecr:DescribeImages",
              "ecr:DescribeImageScanFindings",
            ],
            Resource: `arn:aws:ecr:${config.awsRegion}:${config.awsAccountId}:repository/*`,
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "ecr-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: ecrPolicy.arn,
    });

    // Policy for ECS access (update service)
    const ecsPolicy = new IamPolicy(this, "ecs-policy", {
      name: "github-actions-ecs-policy",
      description: "Allow GitHub Actions to update ECS services",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "ecs:UpdateService",
              "ecs:DescribeServices",
              "ecs:DescribeTaskDefinition",
              "ecs:RegisterTaskDefinition",
              "ecs:ListTasks",
              "ecs:DescribeTasks",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: [
              "iam:PassRole",
            ],
            Resource: [
              `arn:aws:iam::${config.awsAccountId}:role/express-app-*-task-execution-role`,
              `arn:aws:iam::${config.awsAccountId}:role/express-app-*-task-role`,
            ],
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "ecs-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: ecsPolicy.arn,
    });

    // Policy for CloudWatch Logs (for log analysis)
    const logsPolicy = new IamPolicy(this, "logs-policy", {
      name: "github-actions-logs-policy",
      description: "Allow GitHub Actions to read CloudWatch logs",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "logs:FilterLogEvents",
              "logs:GetLogEvents",
              "logs:DescribeLogStreams",
            ],
            Resource: `arn:aws:logs:${config.awsRegion}:${config.awsAccountId}:log-group:/ecs/*`,
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "logs-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: logsPolicy.arn,
    });

    // Store outputs
    this.githubActionsRoleArn = githubActionsRole.arn;

    new TerraformOutput(this, "github-actions-role-arn", {
      value: githubActionsRole.arn,
      description: "IAM role ARN for GitHub Actions OIDC authentication",
    });
  }
}