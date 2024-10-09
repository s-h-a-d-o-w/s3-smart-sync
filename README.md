# s3-smart-sync

## Initial S3 bucket copy must be done manually! This only syncs changes.

# Dev notes

- `tsimp` fails without providing an error message, `tsx` works. 🤷‍♀️

```
> tsimp .

 ELIFECYCLE  Command failed with exit code 13.
```

- Yes, it would be prettier to split up the client code but that would require centralized state handling and at least for now, I'm keeping things simple.

- Didn't use `systray` because it relies on precompiled binaries: https://github.com/zaaack/node-systray/tree/master/traybin. And `trayicon` only supports Windows: https://github.com/131/trayicon/blob/80837912e07c453ad39deea70b1fc566aa98faf3/index.js#L16. `ctray` doesn't support MacOS: https://github.com/diogoalmiro/ctray/issues/2


