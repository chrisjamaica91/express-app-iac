export interface InfraConfig {
  environment: string;
  awsRegion: string;
  awsAccountId: string;
  githubOrg: string;
  
  app: {
    name: string;
    domain?: string;
  };
  
  vpc: {
    cidr: string;
    azCount: number;
    enableNatGateway: boolean;
  };
  
  ecr: {
    repositoryName: string;
    imageScanOnPush: boolean;
    imageTagMutability: 'MUTABLE' | 'IMMUTABLE';
  };
  
  ecs: {
    cpu: number;
    memory: number;
    desiredCount: number;
    minCapacity: number;
    maxCapacity: number;
    containerPort: number;
  };
  
  alb: {
    healthCheckPath: string;
    healthCheckInterval: number;
    healthyThreshold: number;
    unhealthyThreshold: number;
  };
  
  tags: {
    [key: string]: string;
  };
}

export const baseConfig: Partial<InfraConfig> = {
  awsRegion: process.env.AWS_REGION || 'us-east-2',
  awsAccountId: process.env.AWS_ACCOUNT_ID!,
  githubOrg: process.env.GITHUB_ORG!,
  
  app: {
    name: process.env.APP_NAME || 'express-app',
  },
  
  ecr: {
    repositoryName: process.env.ECR_REPOSITORY_NAME || 'express-app',
    imageScanOnPush: true,
    imageTagMutability: 'MUTABLE',
  },
  
  alb: {
    healthCheckPath: '/health',
    healthCheckInterval: 30,
    healthyThreshold: 2,
    unhealthyThreshold: 3,
  },
  
  tags: {
    ManagedBy: 'CDKTF',
    Project: 'express-app',
  },
};