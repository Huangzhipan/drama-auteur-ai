#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-drama-auteur-ai}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-drama-auteur-api}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite-preview}"
GEMINI_IMAGE_MODEL="${GEMINI_IMAGE_MODEL:-gemini-3.1-flash-image-preview}"
ASSET_IMAGE_LIMIT="${ASSET_IMAGE_LIMIT:-4}"

gcloud config set project "$PROJECT_ID"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 600 \
  --set-env-vars "GEMINI_MODEL=${GEMINI_MODEL},GEMINI_IMAGE_MODEL=${GEMINI_IMAGE_MODEL},GEMINI_TIMEOUT_MS=180000,GEMINI_IMAGE_TIMEOUT_MS=90000,ASSET_IMAGE_LIMIT=${ASSET_IMAGE_LIMIT},API_HOST=0.0.0.0,API_PORT=8080" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --project "$PROJECT_ID"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format="value(status.url)")
echo "SERVICE_URL=${SERVICE_URL}"
curl -s "${SERVICE_URL}/health"
