#!/bin/bash -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"; pwd)"  # Figure out where the script is running
. "$SCRIPT_DIR"/lib-robust-bash.sh # load the robust bash library
PROJECT_ROOT="$SCRIPT_DIR"/.. # Figure out where the project directory is

# Ensure dependencies are present

require_binary aws
require_binary sam

# Ensure configuration is present

if [ ! -f "$PROJECT_ROOT/config.sh" ]; then
  echo "ERROR: config.sh is missing. Copy example-config.sh and modify as appropriate."
  echo "   cp example-config.sh config.sh"
  exit 1
fi
source ./config.sh


OUTPUT_TEMPLATE_FILE="$PROJECT_ROOT/serverless-output.yml"
# create s3 backuet if needed
aws s3 mb "s3://$BUCKET_NAME" --region "$REGION" || true

# package and upload to s3
sam package --region "$REGION" \
  --template-file template.yml \
  --output-template-file "$OUTPUT_TEMPLATE_FILE"  \
  --s3-bucket "$BUCKET_NAME"

# deploy to cloudformation
# Start with parameters that are always present
PARAMETERS=(
  "GitHubClientIdParameter=$GITHUB_CLIENT_ID"
  "GitHubClientSecretParameter=$GITHUB_CLIENT_SECRET"
  "CognitoRedirectUriParameter=$COGNITO_REDIRECT_URI"
  "StageNameParameter=$STAGE_NAME"
)

# Add optional parameters if they are set
if [ -n "$GITHUB_ORGS" ]; then
  PARAMETERS+=("GitHubOrgsParameter=$GITHUB_ORGS")
fi
if [ -n "$GITHUB_TEAMS" ]; then
  PARAMETERS+=("GitHubTeamsParameter=$GITHUB_TEAMS")
fi
if [ -n "$GITHUB_SCOPES" ]; then
  PARAMETERS+=("GitHubScopesParameter=$GITHUB_SCOPES")
fi

sam deploy --region "$REGION" \
  --template-file "$OUTPUT_TEMPLATE_FILE" \
  --stack-name "$STACK_NAME" \
  --parameter-overrides "${PARAMETERS[@]}" \
  --capabilities CAPABILITY_IAM
