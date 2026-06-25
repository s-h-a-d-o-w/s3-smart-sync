#!/bin/bash
set -ex

rm *.tar.gz || true

node -e "const fs = require('fs'); const path = require('path'); const ext = process.platform === 'win32' ? '.exe' : ''; const target = path.join('dist', 'node' + ext); fs.copyFileSync(process.execPath, target); fs.chmodSync(target, 0o755);"
if [[ "$OS" == "Windows_NT" ]]; then
  cmd.exe //c build-bootstrap.bat
else
  printf '%s\n' '#!/bin/sh' 'cd "$(dirname "$0")"' 'NODE_ENV=production exec ./node index.js "$@"' > dist/s3-smart-sync
  chmod +x dist/s3-smart-sync
fi

cp INSTRUCTIONS.txt dist/INSTRUCTIONS.txt
cp -r assets dist/assets
cp ../.env.schema dist/.env

version=$(jq -r '.version' ./package.json)
archive_name="s3-smart-sync-${version}-linux-x64"
if [[ "$OS" == "Windows_NT" ]]; then
  powershell.exe -NoProfile -Command "Compress-Archive -Path '.\dist\*' -DestinationPath 's3-smart-sync-${version}-win-x64.zip' -Force"
  rm -rf dist
else
  mv dist $archive_name
  tar -czvf "$archive_name.tar.gz" $archive_name
  rm -rf $archive_name  
fi