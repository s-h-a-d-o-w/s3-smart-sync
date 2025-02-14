import originalTray from "node-tray";
import { IS_CLI } from "./consts.js";

type TrayType = typeof originalTray;

export const createTrayIcon = (
  ...args: Parameters<TrayType["createTrayIcon"]>
): ReturnType<TrayType["createTrayIcon"]> => {
  if (!IS_CLI) {
    return originalTray.createTrayIcon(...args);
  }

  return Promise.resolve();
};

export const destroyTrayIcon = (
  ...args: Parameters<TrayType["destroyTrayIcon"]>
): ReturnType<TrayType["destroyTrayIcon"]> => {
  if (!IS_CLI) {
    return originalTray.destroyTrayIcon(...args);
  }
};

export const updateTrayIconImage = (
  ...args: Parameters<TrayType["updateTrayIconImage"]>
): ReturnType<TrayType["updateTrayIconImage"]> => {
  if (!IS_CLI) {
    return originalTray.updateTrayIconImage(...args);
  }
};

export const updateTrayItem = (
  ...args: Parameters<TrayType["updateTrayItem"]>
): ReturnType<TrayType["updateTrayItem"]> => {
  if (!IS_CLI) {
    return originalTray.updateTrayItem(...args);
  }
};

export const updateTrayTooltip = (
  ...args: Parameters<TrayType["updateTrayTooltip"]>
): ReturnType<TrayType["updateTrayTooltip"]> => {
  if (!IS_CLI) {
    return originalTray.updateTrayTooltip(...args);
  }
};

export type { TrayItem } from "node-tray";
