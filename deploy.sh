#!/bin/bash
set -e

export CAPROVER_APP=s3-smart-sync
export CAPROVER_TAR_FILE=./caprover_deployment.tar

pnpm build:server

echo "Creating archive out of repo and build artifacts..."
tar -cf ./caprover_deployment.tar server.js Dockerfile

echo "Deploying to machine 01..."
export CAPROVER_URL=$CAPROVER_MACHINE_01
npx caprover deploy > /dev/null

rm server.js
rm caprover_deployment.tar
