#!/bin/bash

# Deploy AppSync Schema Updates
# This script updates the AppSync schema with family member fields

set -e

echo "🚀 Starting AppSync Schema Deployment..."

# Configuration
API_ID="gqdqp74uhres5g65ee2ezgpi7q"
REGION="us-east-2"
SCHEMA_FILE="COMPLETE_APPSYNC_SCHEMA.graphql"

# Check if schema file exists
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "❌ Error: $SCHEMA_FILE not found!"
    exit 1
fi

echo "📦 Preparing schema..."

# Convert schema to base64
SCHEMA_BASE64=$(cat "$SCHEMA_FILE" | base64)

# Create temporary JSON file for API call
TEMP_JSON=$(mktemp)
cat > "$TEMP_JSON" << EOF
{
  "definition": "$SCHEMA_BASE64"
}
EOF

echo "☁️  Updating AppSync schema..."

# Start schema creation
aws appsync start-schema-creation \
    --api-id "$API_ID" \
    --cli-input-json "file://$TEMP_JSON" \
    --region "$REGION" \
    --output json > /tmp/schema-update-response.json

echo "✅ Schema update initiated!"

# Clean up
rm "$TEMP_JSON"

# Wait for schema creation to complete
echo "⏳ Waiting for schema creation to complete..."
sleep 5

# Check schema creation status
echo "📋 Checking schema creation status..."
aws appsync get-schema-creation-status \
    --api-id "$API_ID" \
    --region "$REGION" \
    --output json

echo ""
echo "✨ Schema Deployment Initiated!"
echo ""
echo "📋 Next Steps:"
echo "1. Verify the schema in AWS AppSync Console"
echo "2. Test creating/updating patients with family member fields"
echo "3. Check that the family member fields appear in GraphQL queries"
echo ""
