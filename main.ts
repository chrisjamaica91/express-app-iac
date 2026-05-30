import { Construct } from "constructs";
import { App, TerraformStack, TerraformOutput } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

class ExpressAppStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Configure AWS Provider
    new AwsProvider(this, "aws", {
      region: process.env.AWS_REGION || "us-east-2",
    });

    // Output AWS region
    new TerraformOutput(this, "aws-region", {
      value: process.env.AWS_REGION || "us-east-2",
    });

    // Resources will be added here
  }
}

const app = new App();
new ExpressAppStack(app, "express-app-iac");
app.synth();
