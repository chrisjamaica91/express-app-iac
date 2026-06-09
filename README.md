# 🏗️ Express Application - Infrastructure as Code

[![CDKTF](https://img.shields.io/badge/CDKTF-0.21.0-blue.svg)](https://github.com/hashicorp/terraform-cdk)
[![AWS](https://img.shields.io/badge/AWS-ECS%20Fargate-orange.svg)](https://aws.amazon.com/fargate/)

AWS infrastructure for multi-environment Express.js application using CDKTF (Terraform + TypeScript).

**Related Repository:** [express-app](https://github.com/chrisjamaica91/express-app) - Application Code + CI/CD

---

## 📋 Overview

Deploys complete AWS infrastructure across three environments (dev/staging/prod):

- VPC with public/private subnets (2 AZs)
- Application Load Balancer + ECS Fargate
- ECR repository (shared across environments)
- GitHub OIDC provider + IAM roles
- S3 backend with native locking
- CloudWatch logs

---

## 🚀 Deployment for TurboVets

### Prerequisites

**Software:** Node.js 20+, npm 10+, AWS CLI 2.x, Git  
**AWS Permissions:** AdministratorAccess (or permissions for VPC, ECS, ECR, ALB, IAM, S3, CloudWatch)  
**Info Needed:** AWS Account ID, AWS Region, GitHub Organization/Username

---

## 📦 Installation & Deployment

### Step 1: Clone & Install

```bash
git clone https://github.com/YOUR-ORG/express-app-iac.git
cd express-app-iac
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
AWS_ACCOUNT_ID=123456789012     # Your AWS account ID
AWS_REGION=us-east-2            # Your region
GITHUB_ORG=turbovets            # Your GitHub org
ENVIRONMENT=dev                 # Start with dev
```

### Step 3: Authenticate AWS

```bash
aws configure
# Verify:
aws sts get-caller-identity
```

### Step 4: Deploy Stacks (In Order)

**Deploy all environments:**

```bash
# 1. Backend (S3 state bucket)
npx cdktf deploy terraform-backend --auto-approve

# 2. GitHub OIDC
npx cdktf deploy github-oidc --auto-approve

# 3. Dev environment
export ENVIRONMENT=dev
npx cdktf deploy express-app-iam-dev --auto-approve
npx cdktf deploy express-app-iac --auto-approve

# 4. Staging environment
export ENVIRONMENT=staging
npx cdktf deploy express-app-iam-staging --auto-approve
npx cdktf deploy express-app-iac --auto-approve

# 5. Production environment
export ENVIRONMENT=prod
npx cdktf deploy express-app-iam-prod --auto-approve
npx cdktf deploy express-app-iac --auto-approve
```

**Deployment time:** ~5-10 minutes per environment (NAT gateways are slowest)

### Step 5: Verify

```bash
aws ecs list-clusters --region us-east-2
aws ecr describe-repositories --region us-east-2
aws elbv2 describe-load-balancers --region us-east-2
```

### Step 6: Set Up Branch Protection (Recommended)

Protect your infrastructure code with branch protection rules:

**Settings → Branches → Add branch protection rule**

**For `main` branch:**

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- Number of required approvals: **2**
- ✅ Require status checks to pass (if you add tests)

This prevents accidental infrastructure changes and ensures peer review.

---

## 🔧 Configuration

Environment configs are in `config/` directory:

- `base.ts` - Shared config from `.env`
- `dev.ts` / `staging.ts` / `prod.ts` - Environment-specific overrides

**Customize by editing `.env`:**

- `AWS_REGION` - Change deployment region
- `APP_NAME` - Change resource name prefix
- `ECR_REPOSITORY_NAME` - Change ECR repo name

**Customize by editing config files:**

- VPC CIDR ranges (`vpc.cidr`)
- ECS task sizes (`ecs.cpu`, `ecs.memory`)
- Auto-scaling limits (`ecs.minCapacity`, `ecs.maxCapacity`)

---

## 🏗️ Architecture

**Stack Organization:**

```
terraform-backend    → S3 state bucket
github-oidc          → OIDC provider + IAM role
express-app-iam-*    → ECS task roles per env
express-app-iac      → VPC, ALB, ECS per env
```

**Network (per environment):**

- Public subnets: ALB, NAT gateways, Internet Gateway
- Private subnets: ECS tasks (no direct internet)
- Security groups: ALB (port 80) → ECS (port 3000)

---

## 🔄 CI/CD Integration

The [express-app](https://github.com/chrisjamaica91/express-app) repository uses the GitHub OIDC role created here:

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/github-actions-deployment-role
```

**Required GitHub Secrets** (in express-app repo):

- `AWS_ACCOUNT_ID` - Your 12-digit AWS account ID
- `OPENAI_API_KEY` - (Optional) For AI deployment analysis

**DO NOT** add IAM access keys - OIDC handles authentication.

---

## 🧪 Testing

Get ALB DNS and test health endpoint:

```bash
# Get ALB DNS
aws elbv2 describe-load-balancers \
  --names express-app-dev-alb \
  --region us-east-2 \
  --query 'LoadBalancers[0].DNSName' \
  --output text

# Test (after app deployed)
curl http://{alb-dns}/health
# Expected: {"status":"ok","timestamp":"..."}
```

View logs:

```bash
aws logs tail /ecs/express-app-dev-service --region us-east-2 --follow
```

---

## 🔍 Troubleshooting

**"Bucket does not exist"**  
→ Deploy backend first: `npx cdktf deploy terraform-backend --auto-approve`

**"Access Denied"**  
→ Verify AWS permissions: `aws sts get-caller-identity`

**NAT Gateway timeout**  
→ NAT gateways take 5-10 minutes to create

**ECS tasks failing**  
→ ECR image doesn't exist yet. Deploy application first (push to dev branch)  
→ Check events: `aws ecs describe-services --cluster express-app-dev-cluster --services express-app-dev-service --region us-east-2`

**Cannot assume GitHub Actions role**  
→ Update `GITHUB_ORG` in `.env` and redeploy: `npx cdktf deploy github-oidc --auto-approve`

---

## 🧹 Cleanup

**Destroy single environment:**

```bash
export ENVIRONMENT=dev
npx cdktf destroy express-app-iac --auto-approve
npx cdktf destroy express-app-iam-dev --auto-approve
```

**Destroy all resources:**

```bash
for env in dev staging prod; do
  export ENVIRONMENT=$env
  npx cdktf destroy express-app-iac --auto-approve
  npx cdktf destroy express-app-iam-$env --auto-approve
done
npx cdktf destroy github-oidc --auto-approve
aws ecr delete-repository --repository-name express-app --region us-east-2 --force
BUCKET_NAME="express-app-tfstate-$(aws sts get-caller-identity --query Account --output text)"
aws s3 rm s3://$BUCKET_NAME --recursive
npx cdktf destroy terraform-backend --auto-approve
```

## 🚀 Next Steps

After deploying infrastructure:

1. Fork [express-app](https://github.com/chrisjamaica91/express-app) repository
2. Add GitHub secrets: `AWS_ACCOUNT_ID`, `OPENAI_API_KEY` (optional)
3. Set up branch protection rules (see application README)
4. Push to dev branch → Triggers first deployment
5. Test health endpoint: `curl http://{alb-dns}/health`
6. Promote: dev → staging → production

---

## 📞 Support

- 📧 Create an issue in this repository
- 📖 Review [Application README](https://github.com/chrisjamaica91/express-app)
- ☁️ Check AWS Console for resource status

---

**Built with ❤️ for TurboVets DevOps Assessment**
