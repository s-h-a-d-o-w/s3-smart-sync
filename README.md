# s3-smart-sync

I'm using this myself daily, to sync notes and other files between between desktop and tablet (Using Cryptomator, since one can't trust Amazon.)

**As a general rule - don't change/delete files unless the tool is idle (green icon or no log output)!** (It's fine to e.g. drag and drop a ton of files but you will probably run into a problem particularly if you edit the same file repeatedly within a few seconds.)

**Make backups of your data regularly!**

# Dev notes

- Multiple strategies are needed to prevent infinite loops:  
1. Whenever we do something on S3, it triggers SNS and we would repeat the same thing locally that we just did on S3, which would result in syncing to S3, then SNS => infinite loop. To avoid this, there are the `recent...` operations Sets.
1. Timestamps on the local drive have to be synced to S3 - but doing that triggers chokidar. For that, there are `ignoreFiles` in global state.
1. Allowing frequent operations on the same file (which Cryptomator does), is done using the following: All local operations are debounced. If even with debouncing, the same file keeps changing, the client exits at some point because then it's probably a bug.

- `tsimp` fails without providing an error message, `tsx` works. 🤷‍♀️

```
> tsimp .

 ELIFECYCLE  Command failed with exit code 13.
```

- Yes, it would be prettier to split up the client code but that would require centralized state handling and at least for now, I'm keeping things simple.

- Didn't use `systray` because it relies on precompiled binaries: https://github.com/zaaack/node-systray/tree/master/traybin. And `trayicon` only supports Windows: https://github.com/131/trayicon/blob/80837912e07c453ad39deea70b1fc566aa98faf3/index.js#L16. `ctray` doesn't support MacOS: https://github.com/diogoalmiro/ctray/issues/2


