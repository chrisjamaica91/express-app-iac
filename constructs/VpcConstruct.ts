import { Construct } from "constructs";
import { Vpc } from "@cdktf/provider-aws/lib/vpc";
import { Subnet } from "@cdktf/provider-aws/lib/subnet";
import { InternetGateway } from "@cdktf/provider-aws/lib/internet-gateway";
import { NatGateway } from "@cdktf/provider-aws/lib/nat-gateway";
import { Eip } from "@cdktf/provider-aws/lib/eip";
import { RouteTable } from "@cdktf/provider-aws/lib/route-table";
import { RouteTableAssociation } from "@cdktf/provider-aws/lib/route-table-association";
import { Route } from "@cdktf/provider-aws/lib/route";
import { SecurityGroup } from "@cdktf/provider-aws/lib/security-group";
import { SecurityGroupRule } from "@cdktf/provider-aws/lib/security-group-rule";
import { DataAwsAvailabilityZones } from "@cdktf/provider-aws/lib/data-aws-availability-zones";

export interface VpcConfig {
  cidr: string;
  azCount: number;
  tags: { [key: string]: string };
}

export interface VpcOutputs {
  vpcId: string;
  publicSubnetIds: string[];
  privateSubnetIds: string[];
  albSecurityGroupId: string;
  ecsSecurityGroupId: string;
}

export class VpcConstruct extends Construct {
  public readonly outputs: VpcOutputs;

  constructor(scope: Construct, id: string, config: VpcConfig) {
    super(scope, id);

    // Get available AZs
    const azs = new DataAwsAvailabilityZones(this, "azs", {
      state: "available",
    });

    // Create VPC
    const vpc = new Vpc(this, "vpc", {
      cidrBlock: config.cidr,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-vpc`,
      },
    });

    // Create Internet Gateway
    const igw = new InternetGateway(this, "igw", {
      vpcId: vpc.id,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-igw`,
      },
    });

    // Calculate subnet CIDRs (simple /24 subnets)
    const publicSubnets: Subnet[] = [];
    const privateSubnets: Subnet[] = [];

    // Create public and private subnets across AZs
    for (let i = 0; i < config.azCount; i++) {
      // Public subnet (10.x.0.0/24, 10.x.1.0/24, etc.)
      const publicSubnet = new Subnet(this, `public-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: config.cidr.replace(/(\d+\.\d+)\.\d+\.\d+\/\d+/, `$1.${i * 2}.0/24`),
        availabilityZone: `\${${azs.fqn}.names[${i}]}`,
        mapPublicIpOnLaunch: true,
        tags: {
          ...config.tags,
          Name: `${config.tags.Project}-public-subnet-${i + 1}`,
          Type: "Public",
        },
      });
      publicSubnets.push(publicSubnet);

      // Private subnet (10.x.1.0/24, 10.x.3.0/24, etc.)
      const privateSubnet = new Subnet(this, `private-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: config.cidr.replace(/(\d+\.\d+)\.\d+\.\d+\/\d+/, `$1.${i * 2 + 1}.0/24`),
        availabilityZone: `\${${azs.fqn}.names[${i}]}`,
        mapPublicIpOnLaunch: false,
        tags: {
          ...config.tags,
          Name: `${config.tags.Project}-private-subnet-${i + 1}`,
          Type: "Private",
        },
      });
      privateSubnets.push(privateSubnet);
    }

    // Create NAT Gateway (in first public subnet only for cost efficiency)
    const natEip = new Eip(this, "nat-eip", {
      domain: "vpc",
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-nat-eip`,
      },
    });

    const natGateway = new NatGateway(this, "nat-gateway", {
      allocationId: natEip.id,
      subnetId: publicSubnets[0].id,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-nat-gateway`,
      },
    });

    // Create route table for public subnets
    const publicRouteTable = new RouteTable(this, "public-route-table", {
      vpcId: vpc.id,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-public-rt`,
      },
    });

    // Route to Internet Gateway
    new Route(this, "public-route", {
      routeTableId: publicRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: igw.id,
    });

    // Associate public subnets with public route table
    publicSubnets.forEach((subnet, i) => {
      new RouteTableAssociation(this, `public-rta-${i}`, {
        subnetId: subnet.id,
        routeTableId: publicRouteTable.id,
      });
    });

    // Create route table for private subnets
    const privateRouteTable = new RouteTable(this, "private-route-table", {
      vpcId: vpc.id,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-private-rt`,
      },
    });

    // Route to NAT Gateway
    new Route(this, "private-route", {
      routeTableId: privateRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      natGatewayId: natGateway.id,
    });

    // Associate private subnets with private route table
    privateSubnets.forEach((subnet, i) => {
      new RouteTableAssociation(this, `private-rta-${i}`, {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
      });
    });

    // Security Group for ALB (allow HTTP/HTTPS from anywhere)
    const albSecurityGroup = new SecurityGroup(this, "alb-sg", {
      name: `${config.tags.Project}-alb-sg`,
      description: "Security group for Application Load Balancer",
      vpcId: vpc.id,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-alb-sg`,
      },
    });

    // Allow HTTP inbound
    new SecurityGroupRule(this, "alb-http-ingress", {
      type: "ingress",
      fromPort: 80,
      toPort: 80,
      protocol: "tcp",
      cidrBlocks: ["0.0.0.0/0"],
      securityGroupId: albSecurityGroup.id,
      description: "Allow HTTP from anywhere",
    });

    // Allow HTTPS inbound (for future SSL setup)
    new SecurityGroupRule(this, "alb-https-ingress", {
      type: "ingress",
      fromPort: 443,
      toPort: 443,
      protocol: "tcp",
      cidrBlocks: ["0.0.0.0/0"],
      securityGroupId: albSecurityGroup.id,
      description: "Allow HTTPS from anywhere",
    });

    // Allow all outbound
    new SecurityGroupRule(this, "alb-egress", {
      type: "egress",
      fromPort: 0,
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
      securityGroupId: albSecurityGroup.id,
      description: "Allow all outbound traffic",
    });

    // Security Group for ECS Tasks (allow traffic from ALB only)
    const ecsSecurityGroup = new SecurityGroup(this, "ecs-sg", {
      name: `${config.tags.Project}-ecs-sg`,
      description: "Security group for ECS tasks",
      vpcId: vpc.id,
      tags: {
        ...config.tags,
        Name: `${config.tags.Project}-ecs-sg`,
      },
    });

    // Allow traffic from ALB on port 3000
    new SecurityGroupRule(this, "ecs-alb-ingress", {
      type: "ingress",
      fromPort: 3000,
      toPort: 3000,
      protocol: "tcp",
      sourceSecurityGroupId: albSecurityGroup.id,
      securityGroupId: ecsSecurityGroup.id,
      description: "Allow traffic from ALB",
    });

    // Allow all outbound (for pulling images from ECR, etc.)
    new SecurityGroupRule(this, "ecs-egress", {
      type: "egress",
      fromPort: 0,
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
      securityGroupId: ecsSecurityGroup.id,
      description: "Allow all outbound traffic",
    });

    // Store outputs
    this.outputs = {
      vpcId: vpc.id,
      publicSubnetIds: publicSubnets.map((s) => s.id),
      privateSubnetIds: privateSubnets.map((s) => s.id),
      albSecurityGroupId: albSecurityGroup.id,
      ecsSecurityGroupId: ecsSecurityGroup.id,
    };
  }
}