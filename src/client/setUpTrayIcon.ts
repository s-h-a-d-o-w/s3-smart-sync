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
import { isSea } from "node:sea";

export enum TrayIconState {
  Idle,
  Busy,
  Disconnected,
}

let currentState: TrayIconState = TrayIconState.Disconnected;

const autoLaunch = new AutoLaunch({
  name: "S3 Smart Sync",
  path: process.execPath,
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
    items.push({
      id: Symbol(),
      text: "Log level: " + getLogLevel(),
      enabled: false,
    }, {
      id: Symbol(),
      text: "",
      enabled: false,
    });
  }

  if (isSea()) {
    items.push({
      id: Symbol(),
      text: "Run on startup",
      checked: await autoLaunch.isEnabled(),
      onClick: (item) => {
        item.checked ? autoLaunch.disable() : autoLaunch.enable();

        updateTrayItem({
          ...item,
          checked: !item.checked,
        });
      },
    });
  }

  items.push({
    id: Symbol(),
    text: "Exit",
    onClick: () => {
      logger.info("Exiting...");
      destroyTrayIcon();
      process.exit(0);
    },
  });

  createTrayIcon({
    icon: "./assets/icon_disconnected.ico",
    tooltip: "S3 Smart Sync (Disconnected)",
    items,
  });
}
