// src/api/amplifyClient.js
import { Amplify } from "aws-amplify";
import { generateClient } from "@aws-amplify/api";
import awsExports from "../aws-exports";
import { fetchAuthSession } from "@aws-amplify/auth";

Amplify.configure({
  ...awsExports,
  API: {
    GraphQL: {
      endpoint: awsExports.aws_appsync_graphqlEndpoint,
      region: awsExports.aws_appsync_region,
      defaultAuthMode: awsExports.aws_appsync_authenticationType,
    }
  }
});

export const client = generateClient({
  authMode: "AMAZON_COGNITO_USER_POOLS",
  // Manually attach Cognito JWT
  async headers() {
    try {
      const session = await fetchAuthSession();
      const token = session?.tokens?.idToken?.toString();
      if (token) {
        console.log("✅ Using Cognito JWT token for GraphQL");
        // Add Cache-Control header to prevent caching
        return {
          Authorization: token,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        };
      } else {
        console.warn("⚠️ No Cognito token found");
        return {};
      }
    } catch (err) {
      console.error("❌ Failed to fetch auth session", err);
      return {};
    }
  },
});
