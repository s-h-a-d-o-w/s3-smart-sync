#!/bin/bash
set -ex

rm *.zip || true

mv s3-smart-sync.exe dist/
cp INSTRUCTIONS.txt dist/INSTRUCTIONS.txt
cp -r assets dist/assets
cp ../.env.schema dist/.env

cd dist
rm index.cjs
version=$(jq -r '.version' ../package.json)
zip -r "s3-smart-sync-${version}-win-x64.zip" .
mv s3-smart-sync-*.zip ../

cd ..
rm -rf dist
