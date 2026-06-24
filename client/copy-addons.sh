mkdir -p dist/build/Release/
cp node_modules/node-tray/build/Release/tray.node dist/build/Release/
mkdir -p dist/node_modules/bindings
cp -r ../node_modules/.pnpm/bindings*/node_modules/bindings/* dist/node_modules/bindings
mkdir -p dist/node_modules/file-uri-to-path
cp -r ../node_modules/.pnpm/bindings*/node_modules/file-uri-to-path/* dist/node_modules/file-uri-to-path
