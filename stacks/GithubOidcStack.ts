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
    const oidcProvider = new IamOpenidConnectProvider(
      this,
      "github-oidc-provider",
      {
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
      },
    );

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
                "token.actions.githubusercontent.com:sub":
                  config.githubRepos.map(
                    (repo) => `repo:${config.githubOrg}/${repo}:*`,
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
            Action: ["ecr:GetAuthorizationToken"],
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

    // Policy for ECS access (scoped to express-app resources)
    const ecsPolicy = new IamPolicy(this, "ecs-policy", {
      name: "github-actions-ecs-policy",
      description: "Allow GitHub Actions to manage ECS resources",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              // Read-only operations (require Resource: "*")
              "ecs:DescribeClusters",
              "ecs:ListClusters",
              "ecs:DescribeServices",
              "ecs:ListServices",
              "ecs:DescribeTaskDefinition",
              "ecs:ListTaskDefinitions",
              "ecs:ListTaskDefinitionFamilies",
              "ecs:DescribeTasks",
              "ecs:ListTasks",
              "ecs:DescribeContainerInstances",
              "ecs:ListContainerInstances",
              "ecs:DescribeCapacityProviders",
              // Task Definition deregister (AWS requires Resource: "*")
              "ecs:DeregisterTaskDefinition",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: [
              // Cluster operations
              "ecs:CreateCluster",
              "ecs:DeleteCluster",
              "ecs:UpdateCluster",
              "ecs:PutClusterCapacityProviders",
              "ecs:TagResource",
              "ecs:UntagResource",
            ],
            Resource: `arn:aws:ecs:${config.awsRegion}:${config.awsAccountId}:cluster/express-app-*`,
          },
          {
            Effect: "Allow",
            Action: [
              // Service operations
              "ecs:CreateService",
              "ecs:DeleteService",
              "ecs:UpdateService",
              "ecs:UpdateServicePrimaryTaskSet",
              "ecs:TagResource",
              "ecs:UntagResource",
            ],
            Resource: `arn:aws:ecs:${config.awsRegion}:${config.awsAccountId}:service/express-app-*/*`,
          },
          {
            Effect: "Allow",
            Action: [
              // Task Definition operations
              "ecs:RegisterTaskDefinition",
              "ecs:TagResource",
            ],
            Resource: `arn:aws:ecs:${config.awsRegion}:${config.awsAccountId}:task-definition/express-app-*:*`,
          },
          {
            Effect: "Allow",
            Action: [
              // Task operations
              "ecs:RunTask",
              "ecs:StopTask",
            ],
            Resource: `arn:aws:ecs:${config.awsRegion}:${config.awsAccountId}:task/express-app-*/*`,
          },
          {
            Effect: "Allow",
            Action: ["iam:PassRole"],
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

    // Policy for CloudWatch Logs (full CRUD)
    const logsPolicy = new IamPolicy(this, "logs-policy", {
      name: "github-actions-logs-policy",
      description: "Allow GitHub Actions to manage CloudWatch logs",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "logs:CreateLogGroup",
              "logs:DeleteLogGroup",
              "logs:DescribeLogGroups",
              "logs:PutRetentionPolicy",
              "logs:DeleteRetentionPolicy",
              "logs:TagLogGroup",
              "logs:UntagLogGroup",
              "logs:CreateLogStream",
              "logs:DeleteLogStream",
              "logs:DescribeLogStreams",
              "logs:FilterLogEvents",
              "logs:GetLogEvents",
              "logs:PutLogEvents",
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

    // Policy for ALB/ELB access (scoped to express-app resources)
    const albPolicy = new IamPolicy(this, "alb-policy", {
      name: "github-actions-alb-policy",
      description:
        "Allow GitHub Actions to manage load balancers and target groups",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              // Read-only operations (require Resource: "*")
              "elasticloadbalancing:DescribeLoadBalancers",
              "elasticloadbalancing:DescribeTargetGroups",
              "elasticloadbalancing:DescribeListeners",
              "elasticloadbalancing:DescribeRules",
              "elasticloadbalancing:DescribeTags",
              "elasticloadbalancing:DescribeLoadBalancerAttributes",
              "elasticloadbalancing:DescribeTargetGroupAttributes",
              "elasticloadbalancing:DescribeTargetHealth",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: [
              "elasticloadbalancing:CreateLoadBalancer",
              "elasticloadbalancing:DeleteLoadBalancer",
              "elasticloadbalancing:ModifyLoadBalancerAttributes",
              "elasticloadbalancing:SetSecurityGroups",
              "elasticloadbalancing:SetSubnets",
              "elasticloadbalancing:SetIpAddressType",
              "elasticloadbalancing:AddTags",
              "elasticloadbalancing:RemoveTags",
              // CreateListener needs permissions on the load balancer, not the listener
              "elasticloadbalancing:CreateListener",
            ],
            Resource: `arn:aws:elasticloadbalancing:${config.awsRegion}:${config.awsAccountId}:loadbalancer/app/express-app-*/*`,
          },
          {
            Effect: "Allow",
            Action: [
              "elasticloadbalancing:CreateTargetGroup",
              "elasticloadbalancing:DeleteTargetGroup",
              "elasticloadbalancing:ModifyTargetGroup",
              "elasticloadbalancing:ModifyTargetGroupAttributes",
              "elasticloadbalancing:RegisterTargets",
              "elasticloadbalancing:DeregisterTargets",
              "elasticloadbalancing:AddTags",
              "elasticloadbalancing:RemoveTags",
            ],
            Resource: `arn:aws:elasticloadbalancing:${config.awsRegion}:${config.awsAccountId}:targetgroup/express-app-*/*`,
          },
          {
            Effect: "Allow",
            Action: [
              "elasticloadbalancing:DeleteListener",
              "elasticloadbalancing:ModifyListener",
              "elasticloadbalancing:CreateRule",
              "elasticloadbalancing:DeleteRule",
              "elasticloadbalancing:ModifyRule",
              "elasticloadbalancing:SetRulePriorities",
            ],
            Resource: [
              `arn:aws:elasticloadbalancing:${config.awsRegion}:${config.awsAccountId}:listener/app/express-app-*/*`,
              `arn:aws:elasticloadbalancing:${config.awsRegion}:${config.awsAccountId}:listener-rule/app/express-app-*/*`,
            ],
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "alb-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: albPolicy.arn,
    });

    // Policy for VPC and networking resources (scoped with conditions)
    const vpcPolicy = new IamPolicy(this, "vpc-policy", {
      name: "github-actions-vpc-policy",
      description:
        "Allow GitHub Actions to manage VPC and networking resources",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              // Read-only operations (require Resource: "*")
              "ec2:DescribeVpcs",
              "ec2:DescribeSubnets",
              "ec2:DescribeInternetGateways",
              "ec2:DescribeNatGateways",
              "ec2:DescribeAddresses",
              "ec2:DescribeRouteTables",
              "ec2:DescribeSecurityGroups",
              "ec2:DescribeSecurityGroupRules",
              "ec2:DescribeNetworkInterfaces",
              "ec2:DescribeAvailabilityZones",
              "ec2:DescribeTags",
            ],
            Resource: "*",
          },
          {
            Effect: "Allow",
            Action: [
              // Create operations with tagging requirement
              "ec2:CreateVpc",
              "ec2:CreateSubnet",
              "ec2:CreateInternetGateway",
              "ec2:CreateNatGateway",
              "ec2:CreateRouteTable",
              "ec2:CreateSecurityGroup",
              "ec2:CreateNetworkInterface",
              "ec2:CreateRoute",
              "ec2:CreateTags",
              "ec2:AllocateAddress",
            ],
            Resource: "*",
            Condition: {
              StringEquals: {
                "aws:RequestedRegion": config.awsRegion,
              },
            },
          },
          {
            Effect: "Allow",
            Action: [
              // Modify/Delete operations on tagged resources
              "ec2:DeleteVpc",
              "ec2:ModifyVpcAttribute",
              "ec2:DeleteSubnet",
              "ec2:ModifySubnetAttribute",
              "ec2:DeleteInternetGateway",
              "ec2:AttachInternetGateway",
              "ec2:DetachInternetGateway",
              "ec2:DeleteNatGateway",
              "ec2:ReleaseAddress",
              "ec2:AssociateAddress",
              "ec2:DisassociateAddress",
              "ec2:DeleteRouteTable",
              "ec2:AssociateRouteTable",
              "ec2:DisassociateRouteTable",
              "ec2:DeleteRoute",
              "ec2:ReplaceRoute",
              "ec2:DeleteSecurityGroup",
              "ec2:AuthorizeSecurityGroupIngress",
              "ec2:RevokeSecurityGroupIngress",
              "ec2:AuthorizeSecurityGroupEgress",
              "ec2:RevokeSecurityGroupEgress",
              "ec2:ModifySecurityGroupRules",
              "ec2:DeleteNetworkInterface",
              "ec2:ModifyNetworkInterfaceAttribute",
              "ec2:DeleteTags",
            ],
            Resource: "*",
            Condition: {
              StringEquals: {
                "ec2:ResourceTag/Project": "express-app",
              },
            },
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "vpc-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: vpcPolicy.arn,
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

    // Policy for IAM infrastructure management (OIDC, roles, policies)
    const iamManagementPolicy = new IamPolicy(this, "iam-management-policy", {
      name: "github-actions-iam-management-policy",
      description:
        "Allow GitHub Actions to manage IAM resources for infrastructure deployment",
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              // OIDC Provider management
              "iam:GetOpenIDConnectProvider",
              "iam:CreateOpenIDConnectProvider",
              "iam:UpdateOpenIDConnectProviderThumbprint",
              "iam:DeleteOpenIDConnectProvider",
              "iam:TagOpenIDConnectProvider",
              "iam:UntagOpenIDConnectProvider",
              "iam:ListOpenIDConnectProviders",

              // IAM Role management
              "iam:GetRole",
              "iam:CreateRole",
              "iam:UpdateRole",
              "iam:UpdateAssumeRolePolicy",
              "iam:DeleteRole",
              "iam:TagRole",
              "iam:UntagRole",
              "iam:ListRoles",

              // IAM Policy management
              "iam:GetPolicy",
              "iam:CreatePolicy",
              "iam:DeletePolicy",
              "iam:GetPolicyVersion",
              "iam:CreatePolicyVersion",
              "iam:DeletePolicyVersion",
              "iam:ListPolicyVersions",
              "iam:SetDefaultPolicyVersion",
              "iam:TagPolicy",
              "iam:UntagPolicy",

              // Policy attachment management
              "iam:AttachRolePolicy",
              "iam:DetachRolePolicy",
              "iam:PutRolePolicy",
              "iam:DeleteRolePolicy",
              "iam:GetRolePolicy",
              "iam:ListRolePolicies",
              "iam:ListAttachedRolePolicies",

              // Additional permissions for role configuration
              "iam:ListInstanceProfilesForRole",
              "iam:PassRole",
            ],
            Resource: "*", // Required for IAM infrastructure management
          },
        ],
      }),
      tags: config.tags,
    });

    new IamRolePolicyAttachment(this, "iam-management-policy-attachment", {
      role: githubActionsRole.name,
      policyArn: iamManagementPolicy.arn,
    });
  }
}
