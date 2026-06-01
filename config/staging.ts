import { InfraConfig, baseConfig } from './base';

export const stagingConfig: InfraConfig = {
  ...baseConfig,
  environment: 'staging',
  
  vpc: {
    cidr: '10.1.0.0/16',
    azCount: 2,
    enableNatGateway: true,
  },
  
  ecs: {
    cpu: 512,        // 0.5 vCPU (moderate)
    memory: 1024,    // 1 GB
    desiredCount: 2, // 2 tasks for redundancy
    minCapacity: 2,
    maxCapacity: 4,
    containerPort: 3000,
  },
  
  tags: {
    ...baseConfig.tags,
    Environment: 'staging',
  },
} as InfraConfig;