import { Construct } from "constructs";
import { EcrRepository } from "@cdktf/provider-aws/lib/ecr-repository";
import { EcrLifecyclePolicy } from "@cdktf/provider-aws/lib/ecr-lifecycle-policy";

export interface EcrConfig {
  repositoryName: string;
  imageTagMutability: "MUTABLE" | "IMMUTABLE";
  tags: { [key: string]: string };
}

export interface EcrOutputs {
  repositoryUrl: string;
  repositoryArn: string;
  repositoryName: string;
}

export class EcrConstruct extends Construct {
  public readonly outputs: EcrOutputs;

  constructor(scope: Construct, id: string, config: EcrConfig) {
    super(scope, id);

    // Create ECR repository
    const repository = new EcrRepository(this, "repository", {
      name: config.repositoryName,
      imageTagMutability: config.imageTagMutability,
      imageScanningConfiguration: {
        scanOnPush: true, // Enable Trivy scanning
      },
      tags: {
        ...config.tags,
        Name: config.repositoryName,
      },
    });

    // Lifecycle policy - keep last 10 images, expire untagged after 7 days
    new EcrLifecyclePolicy(this, "lifecycle-policy", {
      repository: repository.name,
      policy: JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: "Keep last 10 images",
            selection: {
              tagStatus: "tagged",
              tagPrefixList: ["v", "prod", "staging", "dev"],
              countType: "imageCountMoreThan",
              countNumber: 10,
            },
            action: {
              type: "expire",
            },
          },
          {
            rulePriority: 2,
            description: "Expire untagged images after 7 days",
            selection: {
              tagStatus: "untagged",
              countType: "sinceImagePushed",
              countUnit: "days",
              countNumber: 7,
            },
            action: {
              type: "expire",
            },
          },
        ],
      }),
    });

    this.outputs = {
      repositoryUrl: repository.repositoryUrl,
      repositoryArn: repository.arn,
      repositoryName: repository.name,
    };
  }
}