#!/bin/bash
set -ex

rm *.tar.gz || true

mv s3-smart-sync dist/
cp INSTRUCTIONS.txt dist/INSTRUCTIONS.txt
cp -r assets dist/assets
cp ../.env.schema dist/.env

cd dist
rm index.cjs
version=$(jq -r '.version' ../package.json)
files=$(find . -mindepth 1 -maxdepth 1)
tar -czvf "s3-smart-sync-${version}-linux-x64.tar.gz" $files
mv s3-smart-sync-*.tar.gz ../

cd ..
rm -rf dist
