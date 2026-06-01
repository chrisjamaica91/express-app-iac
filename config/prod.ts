import { InfraConfig, baseConfig } from './base';

export const prodConfig: InfraConfig = {
  ...baseConfig,
  environment: 'prod',
  
  vpc: {
    cidr: '10.2.0.0/16',
    azCount: 3,              // 3 AZs for maximum availability
    enableNatGateway: true,
  },
  
  ecr: {
    ...baseConfig.ecr!,
    imageTagMutability: 'IMMUTABLE',  // Production images never change
  },
  
  ecs: {
    cpu: 1024,       // 1 vCPU (production-grade)
    memory: 2048,    // 2 GB
    desiredCount: 3, // 3 tasks across 3 AZs
    minCapacity: 3,
    maxCapacity: 10, // Scale up to 10 tasks under load
    containerPort: 3000,
  },
  
  tags: {
    ...baseConfig.tags,
    Environment: 'prod',
    CostCenter: 'engineering',
  },
} as InfraConfig;