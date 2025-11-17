#!/bin/bash

# Elderly Dashboard S3 Deployment Script
# This script builds and deploys the React app to S3

set -e  # Exit on error

echo "🚀 Starting deployment process..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
AWS_PROFILE="elderly-dashboard"
AWS_REGION="us-east-2"

# Function to print colored messages
print_message() {
    echo -e "${BLUE}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Step 1: Build the React app
print_message "📦 Building React application..."
npm run build

if [ $? -eq 0 ]; then
    print_success "Build completed successfully"
else
    print_error "Build failed"
    exit 1
fi

# Step 2: Find or create S3 bucket
print_message "🔍 Checking for S3 bucket..."

# List buckets and find one with "elderly" or "dashboard" in the name
BUCKET_NAME=$(aws s3 ls --profile $AWS_PROFILE --region $AWS_REGION | grep -i "elderly\|dashboard" | awk '{print $3}' | head -n 1)

if [ -z "$BUCKET_NAME" ]; then
    print_message "📁 No existing bucket found. Creating new bucket..."
    BUCKET_NAME="elderly-dashboard-$(date +%s)"

    aws s3 mb s3://$BUCKET_NAME \
        --profile $AWS_PROFILE \
        --region $AWS_REGION

    print_success "Created bucket: $BUCKET_NAME"
else
    print_success "Found existing bucket: $BUCKET_NAME"
fi

# Step 3: Configure bucket for static website hosting
print_message "⚙️  Configuring S3 bucket for static website hosting..."

aws s3 website s3://$BUCKET_NAME \
    --index-document index.html \
    --error-document index.html \
    --profile $AWS_PROFILE \
    --region $AWS_REGION

# Step 4: Set bucket policy for public read access
print_message "🔐 Setting bucket policy..."

BUCKET_POLICY=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
        }
    ]
}
EOF
)

echo "$BUCKET_POLICY" > /tmp/bucket-policy.json

aws s3api put-bucket-policy \
    --bucket $BUCKET_NAME \
    --policy file:///tmp/bucket-policy.json \
    --profile $AWS_PROFILE \
    --region $AWS_REGION

rm /tmp/bucket-policy.json

print_success "Bucket policy configured"

# Step 5: Configure CORS for AppSync WebSocket connections
print_message "🌐 Configuring CORS for AppSync..."

CORS_CONFIG=$(cat <<EOF
{
    "CORSRules": [
        {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedOrigins": ["*"],
            "ExposeHeaders": ["ETag"],
            "MaxAgeSeconds": 3000
        }
    ]
}
EOF
)

echo "$CORS_CONFIG" > /tmp/cors-config.json

aws s3api put-bucket-cors \
    --bucket $BUCKET_NAME \
    --cors-configuration file:///tmp/cors-config.json \
    --profile $AWS_PROFILE \
    --region $AWS_REGION

rm /tmp/cors-config.json

print_success "CORS configured"

# Step 6: Upload build files to S3
print_message "📤 Uploading files to S3..."

aws s3 sync ./build s3://$BUCKET_NAME \
    --profile $AWS_PROFILE \
    --region $AWS_REGION \
    --delete \
    --cache-control "public, max-age=31536000" \
    --exclude "index.html" \
    --exclude "service-worker.js"

# Upload index.html and service-worker.js with no-cache
aws s3 cp ./build/index.html s3://$BUCKET_NAME/index.html \
    --profile $AWS_PROFILE \
    --region $AWS_REGION \
    --cache-control "no-cache, no-store, must-revalidate"

if [ -f "./build/service-worker.js" ]; then
    aws s3 cp ./build/service-worker.js s3://$BUCKET_NAME/service-worker.js \
        --profile $AWS_PROFILE \
        --region $AWS_REGION \
        --cache-control "no-cache, no-store, must-revalidate"
fi

print_success "Files uploaded successfully"

# Step 7: Get website endpoint
print_message "🌍 Getting website URL..."

WEBSITE_URL="http://$BUCKET_NAME.s3-website.$AWS_REGION.amazonaws.com"

print_success "Deployment complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}📱 Your dashboard is live at:${NC}"
echo -e "${BLUE}$WEBSITE_URL${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 8: Test WebSocket connectivity
print_message "🔌 Testing AppSync WebSocket connectivity..."

echo ""
echo "To verify live data updates:"
echo "1. Open the dashboard: $WEBSITE_URL"
echo "2. Log in with your credentials"
echo "3. Add a new WatchData entry to DynamoDB"
echo "4. The dashboard should update automatically without refresh"
echo ""
echo "If the dashboard doesn't update automatically, check:"
echo "  - Browser console for WebSocket errors"
echo "  - AppSync API endpoint configuration"
echo "  - Cognito authentication tokens"
echo ""

# Optional: Check if CloudFront distribution exists
print_message "🔍 Checking for CloudFront distribution..."

CF_DISTRIBUTIONS=$(aws cloudfront list-distributions \
    --profile $AWS_PROFILE \
    --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, '$BUCKET_NAME')].DomainName" \
    --output text 2>/dev/null || echo "")

if [ -n "$CF_DISTRIBUTIONS" ]; then
    echo ""
    print_success "CloudFront distribution found:"
    echo -e "${BLUE}https://$CF_DISTRIBUTIONS${NC}"
    echo ""
    echo "Note: CloudFront may take 10-15 minutes to propagate changes"
fi

print_success "Deployment script completed!"
