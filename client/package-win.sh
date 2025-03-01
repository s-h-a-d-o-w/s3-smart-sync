#!/bin/bash
set -ex

rm *.zip || true

mv s3-smart-sync.exe dist/
cp INSTRUCTIONS.txt dist/INSTRUCTIONS.txt
cp -r assets dist/assets
cp ../.env.schema dist/.env

mkdir -p dist/build/Release/
cp node_modules/node-tray/build/Release/tray.node dist/build/Release/
mkdir -p dist/node_modules/bindings
cp -r ../node_modules/.pnpm/bindings*/node_modules/bindings/* dist/node_modules/bindings
mkdir -p dist/node_modules/file-uri-to-path
cp -r ../node_modules/.pnpm/bindings*/node_modules/file-uri-to-path/* dist/node_modules/file-uri-to-path

cd dist
rm index.cjs
version=$(jq -r '.version' ../package.json)
zip -r "s3-smart-sync-${version}-win-x64.zip" .
mv s3-smart-sync-*.zip ../

cd ..
rm -rf dist
