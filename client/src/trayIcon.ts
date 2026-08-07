import { fileExists } from "@s3-smart-sync/shared/fileExists.ts";
import { getLogLevel, logger } from "@s3-smart-sync/shared/logger.ts";
import AutoLaunch from "auto-launch";
import { debounce } from "lodash-es";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import open from "open";
import packageJson from "../package.json" with { type: "json" };
import { IS_WINDOWS, RELEASE_URL } from "./consts.ts";
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
export type TrayIconState = (typeof TrayIconState)[keyof typeof TrayIconState];

let currentState: TrayIconState = TrayIconState.Disconnected;

const ICON_EXTENSION = IS_WINDOWS ? ".ico" : ".png";

const autoLaunchTarget = path.join(
  path.dirname(process.execPath),
  IS_WINDOWS ? "s3-smart-sync-autolaunch.bat" : "s3-smart-sync",
);
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
  } else {
    updateTrayIconImage(
      path.resolve("./assets/icon_disconnected" + ICON_EXTENSION),
    );
  }

  currentState = trayIconState;
}

export async function setUpTrayIcon(
  shutdown: () => Promise<void>,
  updateVersion?: string,
) {
  const items: TrayItem[] = [];

  if (getLogLevel() !== "error") {
    items.push(
      {
        id: Symbol("logLevel"),
        text: "Log level: " + getLogLevel(),
        enabled: false,
      },
      {
        id: Symbol("spacer"),
        text: "",
        enabled: false,
      },
    );
  }

  items.push(
    {
      id: Symbol("version"),
      text: `v${packageJson.version}${updateVersion ? ` (Update available: ${updateVersion})` : ""}`,
      enabled: Boolean(updateVersion),
      onClick: () => {
        void open(RELEASE_URL);
      },
    },
    {
      id: Symbol("runOnStartup"),
      text: "Run on startup",
      checked: await autoLaunch.isEnabled(),
      // It's alright that the tray icon doesn't wait for our code.
      onClick: async (item) => {
        if (IS_WINDOWS && !(await fileExists(autoLaunchTarget))) {
          await writeFile(
            autoLaunchTarget,
            `cmd /c "cd /d ${path.dirname(process.execPath)} && start ${path.basename(process.execPath)}"`,
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
      id: Symbol("exit"),
      text: "Exit",
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
