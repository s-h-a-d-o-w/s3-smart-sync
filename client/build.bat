del client.blob
del *.zip

wsl mv s3-smart-sync.exe dist
copy INSTRUCTIONS.txt dist
xcopy /i assets dist\assets
copy ..\.env.schema dist
rename dist\.env.schema .env

xcopy node_modules\node-tray\build\Release\tray.node dist\build\Release\
mkdir dist\node_modules\bindings
wsl cp -r ../node_modules/.pnpm/bindings*/node_modules/bindings/* dist/node_modules/bindings
mkdir dist\node_modules\file-uri-to-path
wsl cp -r ../node_modules/.pnpm/bindings*/node_modules/file-uri-to-path/* dist/node_modules/file-uri-to-path

cd dist
del index.cjs
powershell -Command "$version=(Get-Content ..\package.json | ConvertFrom-Json).version; wsl zip -r s3-smart-sync-$version-win-x64.zip ."
wsl mv s3-smart-sync-*.zip ..

cd..
wsl rm -rf dist
