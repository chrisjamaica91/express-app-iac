import { Construct } from "constructs";
import { Lb } from "@cdktf/provider-aws/lib/lb";
import { LbTargetGroup } from "@cdktf/provider-aws/lib/lb-target-group";
import { LbListener } from "@cdktf/provider-aws/lib/lb-listener";

export interface AlbConfig {
  name: string;
  vpcId: string;
  publicSubnetIds: string[];
  securityGroupIds: string[];
  targetPort: number;
  healthCheckPath: string;
  tags: { [key: string]: string };
}

export interface AlbOutputs {
  albArn: string;
  albDnsName: string;
  targetGroupArn: string;
  listenerArn: string;
}

export class AlbConstruct extends Construct {
  public readonly outputs: AlbOutputs;

  constructor(scope: Construct, id: string, config: AlbConfig) {
    super(scope, id);

    // Create Application Load Balancer
    const alb = new Lb(this, "alb", {
      name: config.name,
      internal: false,                    // Internet-facing
      loadBalancerType: "application",
      securityGroups: config.securityGroupIds,
      subnets: config.publicSubnetIds,
      enableDeletionProtection: false,    // Set true for production
      enableHttp2: true,
      enableCrossZoneLoadBalancing: true,
      idleTimeout: 60,
      tags: {
        ...config.tags,
        Name: config.name,
      },
    });

    // Create Target Group for ECS tasks
    const targetGroup = new LbTargetGroup(this, "target-group", {
      name: `${config.name}-tg`,
      port: config.targetPort,
      protocol: "HTTP",
      vpcId: config.vpcId,
      targetType: "ip",  // Required for Fargate (uses ENI IPs)
      
      // Health check configuration
      healthCheck: {
        enabled: true,
        path: config.healthCheckPath,
        protocol: "HTTP",
        port: "traffic-port",  // Use same port as target
        healthyThreshold: 2,   // 2 consecutive successes = healthy
        unhealthyThreshold: 3, // 3 consecutive failures = unhealthy
        timeout: 5,            // Wait 5s for response
        interval: 30,          // Check every 30s
        matcher: "200",        // HTTP 200 = healthy
      },

      // Deregistration delay (drain time)
      deregistrationDelay: "30",

      // Stickiness (optional, good for sessions)
      stickiness: {
        enabled: true,
        type: "lb_cookie",
        cookieDuration: 86400,  // 24 hours
      },

      tags: {
        ...config.tags,
        Name: `${config.name}-tg`,
      },
    });

    // Create HTTP Listener (port 80)
    const listener = new LbListener(this, "listener", {
      loadBalancerArn: alb.arn,
      port: 80,
      protocol: "HTTP",
      
      defaultAction: [
        {
          type: "forward",
          targetGroupArn: targetGroup.arn,
        },
      ],

      tags: config.tags,
    });

    // Store outputs
    this.outputs = {
      albArn: alb.arn,
      albDnsName: alb.dnsName,
      targetGroupArn: targetGroup.arn,
      listenerArn: listener.arn,
    };
  }
}