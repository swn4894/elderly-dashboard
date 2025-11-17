#!/bin/bash

# Deploy Lambda Function for Email Notifications
# This script packages and deploys the updated Lambda function

set -e

echo "🚀 Starting Lambda Function Deployment..."

# Configuration
FUNCTION_NAME="GuardianCare-SendAlertNotifications"
REGION="us-east-2"
LAMBDA_FILE="lambda_send_alert_notifications.py"

# Check if lambda file exists
if [ ! -f "$LAMBDA_FILE" ]; then
    echo "❌ Error: $LAMBDA_FILE not found!"
    exit 1
fi

echo "📦 Packaging Lambda function..."

# Create temporary directory for packaging
TEMP_DIR=$(mktemp -d)
echo "📁 Using temp directory: $TEMP_DIR"

# Copy Lambda function to temp directory
cp "$LAMBDA_FILE" "$TEMP_DIR/lambda_function.py"

# Create deployment package
cd "$TEMP_DIR"
zip -q lambda_deployment.zip lambda_function.py
cd - > /dev/null

echo "✅ Package created successfully"

# Deploy to Lambda
echo "☁️  Deploying to AWS Lambda..."

aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$TEMP_DIR/lambda_deployment.zip" \
    --region "$REGION" \
    --output json

echo "✅ Lambda function updated successfully!"

# Clean up
echo "🧹 Cleaning up..."
rm -rf "$TEMP_DIR"

echo ""
echo "✨ Deployment Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Verify the Lambda function in AWS Console"
echo "2. Check CloudWatch Logs for any errors: aws logs tail /aws/lambda/$FUNCTION_NAME --follow --region $REGION"
echo "3. Test by triggering a heart rate alert"
echo "4. Ensure your DynamoDB Stream is connected to this Lambda function"
echo "5. Verify SES email addresses are verified"
echo ""
