node --experimental-sea-config sea-config.json || EXIT /B
node -e "require('fs').copyFileSync(process.execPath, 's3-smart-sync.exe')"
"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool" remove /s s3-smart-sync.exe || EXIT /B
npx postject s3-smart-sync.exe NODE_SEA_BLOB client.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
