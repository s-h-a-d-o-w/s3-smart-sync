import {
  createTrayIcon,
  destroyTrayIcon,
  TrayItem,
  updateTrayIconImage,
  updateTrayItem,
} from "node-tray";
import { getLogLevel, logger } from "../utils/logger.js";
import debounce from "lodash/debounce.js";
import AutoLaunch from "auto-launch";
import { basename, dirname } from "node:path";
import { fileExists } from "../utils/fileExists.js";
import { writeFile } from "node:fs/promises";
import { version } from "../../package.json";
import { IS_WINDOWS } from "./consts.js";

export enum TrayIconState {
  Idle,
  Busy,
  Disconnected,
}

let currentState: TrayIconState = TrayIconState.Disconnected;

const autoLaunchTarget = IS_WINDOWS
  ? dirname(process.execPath) + "\\s3-smart-sync-autolaunch.bat"
  : process.execPath;
const autoLaunch = new AutoLaunch({
  name: "S3 Smart Sync",
  path: autoLaunchTarget,
});

function changeToIdle() {
  updateTrayIconImage("./assets/icon.ico");
  currentState = TrayIconState.Idle;
}
// Changing to idle is debounced because while we want to react quickly when it comes to switching to either busy or disconnected, when e.g. copying many files, there are many attempts to switch it back to idle, making it flicker back and forth, consuming unnecessary resources and being visually distracting.
const debouncedChangeToIdle = debounce(changeToIdle, 500);

export function changeTrayIconState(trayIconState: TrayIconState) {
  if (currentState === trayIconState) {
    return;
  }

  if (trayIconState === TrayIconState.Idle) {
    debouncedChangeToIdle();
    return;
  } else if (trayIconState === TrayIconState.Busy) {
    updateTrayIconImage("./assets/icon_busy.ico");
  } else if (trayIconState === TrayIconState.Disconnected) {
    updateTrayIconImage("./assets/icon_disconnected.ico");
  }

  currentState = trayIconState;
}

export async function setUpTrayIcon() {
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
      text: `v${version}`,
      enabled: false,
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
      onClick: () => {
        logger.info("Exiting...");
        destroyTrayIcon();
        process.exit(0);
      },
    },
  );

  await createTrayIcon({
    icon: "./assets/icon_disconnected.ico",
    tooltip: "S3 Smart Sync (Disconnected)",
    items,
  });
}
