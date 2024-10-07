#!/bin/bash
set -e

export CAPROVER_APP=s3-smart-sync
export CAPROVER_TAR_FILE=./caprover_deployment.tar

echo "Creating archive out of repo and build artifacts..."
tar -cf ./caprover_deployment.tar --exclude=node_modules/* .

echo "Deploying to machine 01..."
export CAPROVER_URL=$CAPROVER_MACHINE_01
npx caprover deploy > /dev/null

rm caprover_deployment.tar
