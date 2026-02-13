#!/bin/bash
set -e
cd "$(dirname "$0")"

AUTH_URL="${AUTH_URL:-http://localhost:8007}" \
CONFIG_SERVICE_URL="${CONFIG_SERVICE_URL:-http://localhost:8013}" \
npx tsx server/src/index.ts
