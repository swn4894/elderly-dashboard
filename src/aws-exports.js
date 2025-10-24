// src/aws-exports.js
const awsExports = {
  aws_project_region: "us-east-2",

  // Cognito config
  aws_cognito_region: "us-east-2",
  aws_user_pools_id: "us-east-2_JtDH7mXwZ",
  aws_user_pools_web_client_id: "2qt8kjentr4qo3m2rnq5ivqsna",
  aws_cognito_identity_pool_id: "", // optional, can leave blank if not using guest access

  // AppSync API config (important!)
  aws_appsync_graphqlEndpoint: "https://aybxzzxll5c2jiimubik2q4hdu.appsync-api.us-east-2.amazonaws.com/graphql",
  aws_appsync_region: "us-east-2",
  aws_appsync_authenticationType: "AMAZON_COGNITO_USER_POOLS",
};

export default awsExports;
