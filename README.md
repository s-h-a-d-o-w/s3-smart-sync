<p align="center"><img src="./client/assets/logo.png" /></p>

# s3-smart-sync

I'm using this myself daily, to sync notes and other files between between desktop and tablet (Using Cryptomator, since one can't trust Amazon. If you do use Cryptomater, you "MUST" [switch from WebDAV to WinFsp in the settings](https://github.com/cryptomator/cryptomator/issues/3576#issuecomment-2409007431)!)

**As a general rule - don't change/delete files unless the client is idle (green icon or no log output)!** (It's fine to e.g. drag and drop a ton of files but you will probably run into a problem particularly if you edit the same file repeatedly within a few seconds.)

**Make backups of your data regularly!**

If you want the tray icon to look prettier, you have to manually enable the compatibility setting -> high DPI -> scaling behavior performed by: application.

## Compatibility

**If you can test and confirm any of the `?`, please let me know!** (Even if it doesn't work. *Especially* if it doesn't work... 😄)

|         | "UI" (Tray icon) | CLI |
|---------|------------------|-----|
| Windows | ✅                | ✅   |
| Linux   | ?                | ✅   |
| Mac     | ?                | ?   |

## How to use (server)

- Deploy the server using the Dockerfile or of course cloning and doing what's in Dockerfile directly on the server. Use `pnpm build:server` either before building the docker image or during the steps, depending on how you end up deploying. (Messages sent by the server contain file paths, so I strongly recommend using WSS. If you deploy using CapRover, you can simply enable HTTPS/websockets and it'll take care of the letsencrypt certificate renewal.)
- On AWS, create an SNS topic (this isn't just for performance and cost effectiveness but also for compatibility with anything else that might cause changes in the S3 bucket) and add an HTTP(S) subscription using the URL `<your server>/sns`. Then configure your S3 bucket to send notifications to that SNS topic.

## How to use (client with UI)

- Run the latest release on your client machine(s).

## How to use (client with CLI)

Logs to console instead of files.

- Run the latest release with the commandline argument `cli`.

## Dev notes

- I've been going back and forth between `node:sea` and `pkg`. Because of that, I am keeping the code for both - for the time being at least. The latest is that with `node:sea`, one gets brief command prompt popups here and there, while one doesn't with `pkg`.
- To build with `node:sea`, you have to install [the signing feature of the Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/) and possibly change the path in `build-sea.bat`.
- Tray icon DPI nonsense: I tried to attach a [manifest](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process) to both `pkg` and `node:sea` .exes using both `mt` and `rcedit`. The `pkg` exe shrinks by 4 MB and doesn't work any more. With the `node:sea` exe, `rcedit` freezes. `mt` works but would require a environment variable override: "Node.js is only supported on Windows 8.1, Windows Server 2012 R2, or higher. Setting the NODE_SKIP_PLATFORM_CHECK environment variable to 1 skips this check, ...". Since it's not possible to bake environment variables into the .exe with `node:sea`, this is obviously not acceptable either. The only thing I can think of to resolve this would be to create a non-node wrapper that runs the .exe. Or maybe `bun` or `deno` become a viable alternative at some point (As of October 2024, I don't consider either of them anywhere near production ready. `bun` can't handle windows paths, at least in with projects like this one. `deno` still [doesn't clean up unneeded npm packages](https://github.com/denoland/deno/issues/21261).)
- Multiple strategies are needed to prevent infinite loops:
1. Whenever we do something on S3, it triggers SNS and we would repeat the same thing locally that we just did on S3, which would result in: Syncing to S3 => getting SNS => Syncing to S3 => infinite loop. To avoid this, the last modified date is synced after uploading/downloading and checked before uploading/downloading.
2. Whenever a file is manipulated locally, it is added to `ignoreMaps`. Which makes it so that when the file watcher triggers because of what the client does rather than what the user does, that trigger is ignored.
3. Allowing frequent operations on the same file (which Cryptomator does), is achieved using the following: All local operations are debounced. If even with debouncing, the same file keeps changing without regularly changing in size, the client exits at some point because then it's probably a bug.

- `tsimp` fails without providing an error message, `tsx` works. 🤷‍♀️

```
> tsimp .

 ELIFECYCLE  Command failed with exit code 13.
```

## TODO

- Make use of a docker registry so that people can easily run the latest server version.
- Use some CLI library instead of parsing command line arguments manually and not offering help.
