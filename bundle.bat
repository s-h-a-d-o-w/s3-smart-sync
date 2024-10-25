cmd /c esbuild ./src/client/index.ts --bundle --platform=node --target=node20 --external:*.node --outfile=dist/index.cjs
xcopy node_modules\winax\build\Release\node_activex.node dist\build\Release\
