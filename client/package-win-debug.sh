#!/bin/bash
set -ex

rm *.zip || true

cp INSTRUCTIONS.txt dist/INSTRUCTIONS.txt
cp -r assets dist/assets
cp ../.env dist/.env
