import { Construct } from "constructs";
import { TerraformStack, TerraformOutput, S3Backend } from "cdktf";
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

    // Add S3Backend
    new S3Backend(this, {
        bucket: `express-app-tfstate-${config.awsAccountId}`,
        key: "github-oidc/terraform.tfstate", // NOT environment-specific
        region: config.awsRegion,
        encrypt: true,
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

        // Policy for ALB access (for deployment verification and AI analysis)
    const albPolicy = new IamPolicy(this, "alb-policy", {
      name: "github-actions-alb-policy",
      description: "Allow GitHub Actions to describe load balancers and target groups",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "elasticloadbalancing:DescribeLoadBalancers",
              "elasticloadbalancing:DescribeTargetGroups",
              "elasticloadbalancing:DescribeTargetHealth",
              "elasticloadbalancing:DescribeListeners",
            ],
            Resource: "*",
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "alb-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: albPolicy.arn,
    });

    // Store outputs
    this.githubActionsRoleArn = githubActionsRole.arn;

    new TerraformOutput(this, "github-actions-role-arn", {
      value: githubActionsRole.arn,
      description: "IAM role ARN for GitHub Actions OIDC authentication",
    });

    // Policy for S3 state backend access (with native locking)
    const s3StatePolicy = new IamPolicy(this, "s3-state-policy", {
    name: "github-actions-s3-state-policy",
    description: "Allow GitHub Actions to access Terraform state in S3",
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
        {
            Effect: "Allow",
            Action: [
            "s3:GetObject",
            "s3:PutObject",
            "s3:DeleteObject",
            "s3:ListBucket",
            "s3:GetObjectVersion", // For locking
            ],
            Resource: [
            `arn:aws:s3:::express-app-tfstate-${config.awsAccountId}`, // ← Dynamic
          `arn:aws:s3:::express-app-tfstate-${config.awsAccountId}/*`, // ← Dynamic
            ],
        },
        ],
    }),
    tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "s3-state-policy-attachment", {
    role: githubActionsRole.name,
    policyArn: s3StatePolicy.arn,
    });

    // Policy for Terraform read operations (comprehensive)
const terraformReadPolicy = new IamPolicy(this, "terraform-read-policy", {
  name: "github-actions-terraform-read-policy",
  description: "Allow Terraform to read AWS infrastructure state",
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          // ===== EC2/VPC - All read operations =====
          "ec2:Describe*",
          "ec2:GetConsoleOutput",
          "ec2:GetConsoleScreenshot",
          
          // ===== ECR - All read operations =====
          "ecr:Describe*",
          "ecr:List*",
          "ecr:Get*",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
          
          // ===== ECS - All read operations =====
          "ecs:Describe*",
          "ecs:List*",
          
          // ===== CloudWatch Logs - All read operations =====
          "logs:Describe*",
          "logs:List*",
          "logs:Get*",
          "logs:FilterLogEvents",
          "logs:TestMetricFilter",
          
          // ===== Elastic Load Balancing - All read operations =====
          "elasticloadbalancing:Describe*",
          
          // ===== IAM - Read operations for role verification =====
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListPolicyVersions",
          "iam:ListInstanceProfilesForRole",
          
          // ===== Application Auto Scaling (if used) =====
          "application-autoscaling:Describe*",
          
          // ===== Service Discovery (if used) =====
          "servicediscovery:Get*",
          "servicediscovery:List*",
          
          // ===== Secrets Manager (if used) =====
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecrets",
          "secretsmanager:ListSecretVersionIds",
        ],
        Resource: "*", // Read-only operations, AWS best practice allows "*"
      },
    ],
  }),
  tags: config.tags,
});

new IamRolePolicyAttachment(this, "terraform-read-policy-attachment", {
  role: githubActionsRole.name,
  policyArn: terraformReadPolicy.arn,
});
  }
}