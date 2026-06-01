import { InfraConfig, baseConfig } from './base';

export const devConfig: InfraConfig = {
  ...baseConfig,
  environment: 'dev',
  
  vpc: {
    cidr: '10.0.0.0/16',
    azCount: 2,
    enableNatGateway: true,
  },
  
  ecs: {
    cpu: 256,        // 0.25 vCPU (minimal for dev)
    memory: 512,     // 512 MB
    desiredCount: 1, // Only 1 task (save money)
    minCapacity: 1,
    maxCapacity: 2,
    containerPort: 3000,
  },
  
  tags: {
    ...baseConfig.tags,
    Environment: 'dev',
  },
} as InfraConfig;