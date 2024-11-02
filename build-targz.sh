#!/bin/bash
rm *.tar.gz

mkdir dist
mv s3-smart-sync dist/
cp CLIENT_INSTRUCTIONS.txt dist/INSTRUCTIONS.txt
cp -r assets dist/assets
cp .env.schema dist/.env

mkdir -p dist/build/Release/
cp node_modules/node-tray/build/Release/tray.node dist/build/Release/
mkdir -p dist/node_modules/bindings
cp -r node_modules/.pnpm/bindings*/node_modules/bindings/* dist/node_modules/bindings
mkdir -p dist/node_modules/file-uri-to-path
cp -r node_modules/.pnpm/bindings*/node_modules/file-uri-to-path/* dist/node_modules/file-uri-to-path

cd dist
rm index.cjs
tar -czvf s3-smart-sync-$(jq -r '.version' ../package.json)-linux-x64.tar.gz .
mv s3-smart-sync-*.tar.gz ../

cd ..
rm -rf dist
