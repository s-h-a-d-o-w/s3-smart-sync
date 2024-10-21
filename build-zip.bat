del client.blob
del *.zip

wsl mv s3-smart-sync.exe dist
copy CLIENT_INSTRUCTIONS.txt dist
rename dist\CLIENT_INSTRUCTIONS.txt INSTRUCTIONS.txt
xcopy /i assets dist\assets
copy .env.schema dist
rename dist\.env.schema .env

xcopy node_modules\node-tray\build\Release\tray.node dist\build\Release\
mkdir dist\node_modules
xcopy /i node_modules\node-tray\node_modules\bindings dist\node_modules\bindings
xcopy /i node_modules\node-tray\node_modules\file-uri-to-path dist\node_modules\file-uri-to-path

cd dist
del index.cjs
powershell -Command "$version=(Get-Content ..\package.json | ConvertFrom-Json).version; wsl zip -r s3-smart-sync-$version.zip ."
wsl mv s3-smart-sync-1.0.0.zip ..

cd..
wsl rm -rf dist
