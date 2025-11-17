#!/bin/bash

# AppSync Schema Fix Script
# This script configures the Elderly type in AppSync

set -e

echo "🔧 Fixing AppSync Schema for Elderly Management..."
echo ""

API_ID="gqdqp74uhres5g65ee2ezgpi7q"
REGION="us-east-2"
PROFILE="elderly-dashboard"
DATA_SOURCE="ElderlyTable"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if data source already exists
print_info "Checking if ElderlyTable data source exists..."
if aws appsync get-data-source \
    --api-id $API_ID \
    --name $DATA_SOURCE \
    --region $REGION \
    --profile $PROFILE &>/dev/null; then
    print_success "Data source already exists"
else
    print_error "Data source not found (this is expected)"
fi

# Create VTL templates
mkdir -p /tmp/appsync-resolvers

# listElderly resolver
cat > /tmp/appsync-resolvers/list-elderly-request.vtl << 'EOF'
{
  "version": "2017-02-28",
  "operation": "Scan",
  #if($ctx.args.limit)
    "limit": $ctx.args.limit,
  #end
  #if($ctx.args.nextToken)
    "nextToken": "$ctx.args.nextToken",
  #end
  #if($ctx.args.filter)
    "filter": $util.transform.toDynamoDBFilterExpression($ctx.args.filter),
  #end
}
EOF

# getElderly resolver
cat > /tmp/appsync-resolvers/get-elderly-request.vtl << 'EOF'
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "elderlyID": $util.dynamodb.toDynamoDBJson($ctx.args.elderlyID)
  }
}
EOF

# getElderlyByDeviceId resolver
cat > /tmp/appsync-resolvers/get-elderly-by-device-request.vtl << 'EOF'
{
  "version": "2017-02-28",
  "operation": "Query",
  "index": "deviceId-index",
  "query": {
    "expression": "deviceId = :deviceId",
    "expressionValues": {
      ":deviceId": $util.dynamodb.toDynamoDBJson($ctx.args.deviceId)
    }
  }
}
EOF

# Response template (used by all)
cat > /tmp/appsync-resolvers/response.vtl << 'EOF'
$util.toJson($ctx.result)
EOF

# Query response for getElderlyByDeviceId (returns first item)
cat > /tmp/appsync-resolvers/query-response.vtl << 'EOF'
#if($ctx.result.items.size() > 0)
  $util.toJson($ctx.result.items[0])
#else
  null
#end
EOF

print_success "VTL templates created"

# Function to create resolver
create_resolver() {
    local TYPE_NAME=$1
    local FIELD_NAME=$2
    local REQUEST_TEMPLATE=$3
    local RESPONSE_TEMPLATE=$4

    print_info "Creating resolver for $TYPE_NAME.$FIELD_NAME..."

    if aws appsync create-resolver \
        --api-id $API_ID \
        --type-name $TYPE_NAME \
        --field-name $FIELD_NAME \
        --data-source-name $DATA_SOURCE \
        --request-mapping-template "file:///tmp/appsync-resolvers/$REQUEST_TEMPLATE" \
        --response-mapping-template "file:///tmp/appsync-resolvers/$RESPONSE_TEMPLATE" \
        --region $REGION \
        --profile $PROFILE &>/dev/null; then
        print_success "Resolver $FIELD_NAME created successfully"
        return 0
    else
        print_error "Failed to create resolver $FIELD_NAME (may already exist or field not in schema)"
        return 1
    fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  MANUAL STEP REQUIRED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "The AppSync schema needs to be updated manually in the AWS Console."
echo ""
echo "Please follow these steps:"
echo ""
echo "1. Open: https://us-east-2.console.aws.amazon.com/appsync/home?region=us-east-2"
echo "2. Select API: ElderlyMonitoringAPI"
echo "3. Click 'Schema' in the left sidebar"
echo "4. Copy the schema additions from APPSYNC_SCHEMA_UPDATE.md"
echo "5. Click 'Save Schema'"
echo ""
echo "Then run this script again with: ./fix-appsync-schema.sh --create-resolvers"
echo ""
echo "Or see APPSYNC_SCHEMA_UPDATE.md for detailed instructions"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# If --create-resolvers flag is provided, create the resolvers
if [[ "$1" == "--create-resolvers" ]]; then
    echo ""
    echo "Creating resolvers..."
    echo ""

    # Try to create Query resolvers
    create_resolver "Query" "listElderly" "list-elderly-request.vtl" "response.vtl" || true
    create_resolver "Query" "getElderly" "get-elderly-request.vtl" "response.vtl" || true
    create_resolver "Query" "getElderlyByDeviceId" "get-elderly-by-device-request.vtl" "query-response.vtl" || true

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_success "Resolver creation attempted"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Note: Mutation resolvers (create/update/delete) must be"
    echo "configured manually in the AWS Console for proper functionality."
    echo ""
    echo "See APPSYNC_SCHEMA_UPDATE.md for complete instructions."
    echo ""
fi

print_info "Script complete. Please update the schema in AWS Console first."
