#!/bin/bash
set -ex

rm *.tar.gz || true

version=$(jq -r '.version' ./package.json)
archive_name="s3-smart-sync-${version}-linux-x64"

mkdir $archive_name
mv s3-smart-sync $archive_name/
cp INSTRUCTIONS.txt $archive_name/INSTRUCTIONS.txt
cp -r assets $archive_name/assets
cp ../.env.schema $archive_name/.env

tar -czvf "$archive_name.tar.gz" $archive_name
rm -rf $archive_name