# s3-smart-sync

I'm using this myself daily, to sync notes and other files between between desktop and tablet (Using Cryptomator, since one can't trust Amazon.)

**As a general rule - don't change/delete files unless the tool is idle (green icon or no log output)!** (It's fine to e.g. drag and drop a ton of files but you will probably run into a problem particularly if you edit the same file repeatedly within a few seconds.)

**Make backups of your data regularly!**

If you want the tray icon to look prettier, you have to manually enable the compatibility setting -> high DPI -> scaling behavior performed by: application.

# How to use

- Deploy the server using Dockerfile or of course cloning and doing what's in Dockerfile directly on the server. (Messages sent by the server contain file paths, so I strongly recommend using WSS. If you deploy using CapRover, you can simply enable HTTPS/websockets and it'll take care of the letsencrypt certificate renewal.)
- Clone on your client and run `install` and `start:client`. (Or use the prebuilt binary data that I will probably put into releases here.)

# Dev notes

- Tray icon DPI nonsense: I tried to attach a [manifest](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process) to both `pkg` and `node:sea` .exes using both `mt` and `rcedit`. The `pkg` exe shrinks by 4 MB and doesn't work any more. With the `node:sea` exe, `rcedit` freezes. `mt` works but would require a environment variable override: "Node.js is only supported on Windows 8.1, Windows Server 2012 R2, or higher. Setting the NODE_SKIP_PLATFORM_CHECK environment variable to 1 skips this check, ...". Since it's not possible to bake environment variables into the .exe with `node:sea`, this is obviously not acceptable either. The only thing I can think of to resolve this would be to create a non-node wrapper that runs the .exe. Or maybe `bun` or `deno` become a viable alternative at some point (As of October 2024, I don't consider either of them anywhere near production ready. `bun` can't handle windows paths, at least in with projects like this one. `deno` still [doesn't clean up unneeded npm packages](https://github.com/denoland/deno/issues/21261).)
- Multiple strategies are needed to prevent infinite loops:  
1. Whenever we do something on S3, it triggers SNS and we would repeat the same thing locally that we just did on S3, which would result in: Syncing to S3 => getting SNS => Syncing to S3 => infinite loop. To avoid this, the last modified date is synced after uploading/downloading and checked before uploading/downloading.
2. Syncing timestamps triggers chokidar. For that, there is `ignoreFiles` in global state.
3. Allowing frequent operations on the same file (which Cryptomator does), is done using the following: All local operations are debounced. If even with debouncing, the same file keeps changing without regularly changing in size, the client exits at some point because then it's probably a bug.

- `tsimp` fails without providing an error message, `tsx` works. 🤷‍♀️

```
> tsimp .

 ELIFECYCLE  Command failed with exit code 13.
```

- Didn't use `systray` because it relies on precompiled binaries: https://github.com/zaaack/node-systray/tree/master/traybin. And `trayicon` only supports Windows: https://github.com/131/trayicon/blob/80837912e07c453ad39deea70b1fc566aa98faf3/index.js#L16. `ctray` doesn't support MacOS: https://github.com/diogoalmiro/ctray/issues/2


