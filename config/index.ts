import { InfraConfig } from './base';
import { devConfig } from './dev';
import { stagingConfig } from './staging';
import { prodConfig } from './prod';

const configs: { [key: string]: InfraConfig } = {
  dev: devConfig,
  staging: stagingConfig,
  prod: prodConfig,
};

export function getConfig(environment: string = 'dev'): InfraConfig {
  const config = configs[environment];
  
  if (!config) {
    throw new Error(
      `Unknown environment: ${environment}. Valid options: ${Object.keys(configs).join(', ')}`
    );
  }
  
  // Validate required fields
  if (!config.awsAccountId) {
    throw new Error('AWS_ACCOUNT_ID must be set in .env file');
  }
  
  return config;
}

export * from './base';
export { devConfig, stagingConfig, prodConfig };