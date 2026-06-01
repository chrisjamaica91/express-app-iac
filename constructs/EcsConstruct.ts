import { Construct } from "constructs";
import { EcsCluster } from "@cdktf/provider-aws/lib/ecs-cluster";
import { EcsTaskDefinition } from "@cdktf/provider-aws/lib/ecs-task-definition";
import { EcsService } from "@cdktf/provider-aws/lib/ecs-service";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group";

export interface EcsConfig {
  clusterName: string;
  serviceName: string;
  taskFamily: string;
  cpu: number;
  memory: number;
  desiredCount: number;
  containerImage: string;
  containerPort: number;
  taskRoleArn: string;
  executionRoleArn: string;
  securityGroupIds: string[];
  subnetIds: string[];
  targetGroupArn: string;
  tags: { [key: string]: string };
}

export interface EcsOutputs {
  clusterArn: string;
  clusterName: string;
  serviceArn: string;
  serviceName: string;
  taskDefinitionArn: string;
}

export class EcsConstruct extends Construct {
  public readonly outputs: EcsOutputs;

  constructor(scope: Construct, id: string, config: EcsConfig) {
    super(scope, id);

    // Create CloudWatch log group
    const logGroup = new CloudwatchLogGroup(this, "log-group", {
      name: `/ecs/${config.serviceName}`,
      retentionInDays: 7, // 7 days for dev, increase for prod
      tags: config.tags,
    });

    // Create ECS cluster
    const cluster = new EcsCluster(this, "cluster", {
      name: config.clusterName,
      setting: [
        {
          name: "containerInsights",
          value: "enabled",
        },
      ],
      tags: {
        ...config.tags,
        Name: config.clusterName,
      },
    });

    // Create task definition
    const taskDefinition = new EcsTaskDefinition(this, "task-definition", {
      family: config.taskFamily,
      requiresCompatibilities: ["FARGATE"],
      networkMode: "awsvpc",
      cpu: config.cpu.toString(),
      memory: config.memory.toString(),
      taskRoleArn: config.taskRoleArn,
      executionRoleArn: config.executionRoleArn,
      containerDefinitions: JSON.stringify([
        {
          name: config.serviceName,
          image: config.containerImage,
          essential: true,
          portMappings: [
            {
              containerPort: config.containerPort,
              protocol: "tcp",
            },
          ],
          environment: [
            {
              name: "NODE_ENV",
              value: "production",
            },
            {
              name: "PORT",
              value: config.containerPort.toString(),
            },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroup.name,
              "awslogs-region": "us-east-2", // TODO: make dynamic
              "awslogs-stream-prefix": "ecs",
            },
          },
          healthCheck: {
            command: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 60,
          },
        },
      ]),
      tags: config.tags,
    });

    // Create ECS service
    const service = new EcsService(this, "service", {
      name: config.serviceName,
      cluster: cluster.arn,
      taskDefinition: taskDefinition.arn,
      desiredCount: config.desiredCount,
      launchType: "FARGATE",
      networkConfiguration: {
        subnets: config.subnetIds,
        securityGroups: config.securityGroupIds,
        assignPublicIp: false, // Private subnets
      },
      loadBalancer: [
        {
          targetGroupArn: config.targetGroupArn,
          containerName: config.serviceName,
          containerPort: config.containerPort,
        },
      ],
      healthCheckGracePeriodSeconds: 60,
      tags: config.tags,
    });

    this.outputs = {
      clusterArn: cluster.arn,
      clusterName: cluster.name,
      serviceArn: service.id,
      serviceName: service.name,
      taskDefinitionArn: taskDefinition.arn,
    };
  }
}