import { fileExists } from "@s3-smart-sync/shared/fileExists.ts";
import { getLogLevel, logger } from "@s3-smart-sync/shared/logger.ts";
import AutoLaunch from "auto-launch";
import { debounce } from "lodash-es";
import { writeFile } from "node:fs/promises";
import path, { basename, dirname } from "node:path";
import open from "open";
import packageJson from "../package.json" with { type: "json" };
import { IS_WINDOWS, RELEASE_URL } from "./consts.ts";
import { shutdown } from "./index.ts";
import {
  createTrayIcon,
  type TrayItem,
  updateTrayIconImage,
  updateTrayItem,
} from "./trayWrapper.ts";

export const TrayIconState = {
  Busy: "busy",
  Disconnected: "disconnected",
  Idle: "idle",
} as const;
export type TrayIconState =
  (typeof TrayIconState)[keyof typeof TrayIconState];

let currentState: TrayIconState = TrayIconState.Disconnected;

const ICON_EXTENSION = IS_WINDOWS ? ".ico" : ".png";
console.log("ICON_EXTENSION", ICON_EXTENSION);

const autoLaunchTarget = IS_WINDOWS
  ? dirname(process.execPath) + "\\s3-smart-sync-autolaunch.bat"
  : process.execPath;
const autoLaunch = new AutoLaunch({
  name: "S3 Smart Sync",
  path: autoLaunchTarget,
});

function changeToIdle() {
  updateTrayIconImage(path.resolve("./assets/icon" + ICON_EXTENSION));
  currentState = TrayIconState.Idle;
}
// Changing to idle is debounced because while we want to react quickly when it comes to switching to either busy or disconnected, when e.g. copying many files, there are many attempts to switch it back to idle, making it flicker back and forth, consuming unnecessary resources and being visually distracting.
const debouncedChangeToIdle = debounce(changeToIdle, 1000);

export function changeTrayIconState(trayIconState: TrayIconState) {
  if (currentState === trayIconState) {
    return;
  }

  if (trayIconState === TrayIconState.Idle) {
    debouncedChangeToIdle();
    return;
  } else if (trayIconState === TrayIconState.Busy) {
    updateTrayIconImage(path.resolve("./assets/icon_busy" + ICON_EXTENSION));
  } else if (trayIconState === TrayIconState.Disconnected) {
    updateTrayIconImage(path.resolve("./assets/icon_disconnected" + ICON_EXTENSION));
  }

  currentState = trayIconState;
}

export async function setUpTrayIcon(updateVersion?: string) {
  const items: TrayItem[] = [];

  if (getLogLevel() !== "error") {
    items.push(
      {
        id: Symbol(),
        text: "Log level: " + getLogLevel(),
        enabled: false,
      },
      {
        id: Symbol(),
        text: "",
        enabled: false,
      },
    );
  }

  items.push(
    {
      id: Symbol(),
      text: `v${packageJson.version}${updateVersion ? ` (Update available: ${updateVersion})` : ""}`,
      enabled: Boolean(updateVersion),
      onClick: () => {
        void open(RELEASE_URL);
      },
    },
    {
      id: Symbol(),
      text: "Run on startup",
      checked: await autoLaunch.isEnabled(),
      // It's alright that the tray icon doesn't wait for our code.
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onClick: async (item) => {
        if (IS_WINDOWS && !(await fileExists(autoLaunchTarget))) {
          await writeFile(
            autoLaunchTarget,
            `cmd /c "cd /d ${dirname(process.execPath)} && start ${basename(process.execPath)}"`,
          );
        }

        await (item.checked ? autoLaunch.disable() : autoLaunch.enable());

        updateTrayItem({
          ...item,
          checked: !item.checked,
        });
      },
    },
    {
      id: Symbol(),
      text: "Exit",
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onClick: async () => {
        logger.info("Exiting...");
        await shutdown();
        // Delay exit to allow logs to flush
        setTimeout(() => process.exit(0), 100);
      },
    },
  );

  await createTrayIcon({
    icon: path.resolve("./assets/icon_disconnected" + ICON_EXTENSION),
    tooltip: "S3 Smart Sync (Disconnected)",
    items,
  });
}
