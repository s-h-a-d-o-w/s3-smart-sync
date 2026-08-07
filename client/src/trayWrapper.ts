import {
  createTrayIcon as originalCreateTrayIcon,
  destroyTrayIcon as originalDestroyTrayIcon,
  updateTrayIconImage as originalUpdateTrayIconImage,
  updateTrayItem as originalUpdateTrayItem,
  updateTrayTooltip as originalUpdateTrayTooltip,
} from "node-tray";
import { IS_CLI } from "./consts.ts";

export const createTrayIcon = (
  ...args: Parameters<typeof originalCreateTrayIcon>
): ReturnType<typeof originalCreateTrayIcon> => {
  if (!IS_CLI) {
    return originalCreateTrayIcon(...args);
  }

  return Promise.resolve();
};

export const destroyTrayIcon = (
  ...args: Parameters<typeof originalDestroyTrayIcon>
): ReturnType<typeof originalDestroyTrayIcon> => {
  if (!IS_CLI) {
    return originalDestroyTrayIcon(...args);
  }
};

export const updateTrayIconImage = (
  ...args: Parameters<typeof originalUpdateTrayIconImage>
): ReturnType<typeof originalUpdateTrayIconImage> => {
  if (!IS_CLI) {
    return originalUpdateTrayIconImage(...args);
  }
};

export const updateTrayItem = (
  ...args: Parameters<typeof originalUpdateTrayItem>
): ReturnType<typeof originalUpdateTrayItem> => {
  if (!IS_CLI) {
    return originalUpdateTrayItem(...args);
  }
};

export const updateTrayTooltip = (
  ...args: Parameters<typeof originalUpdateTrayTooltip>
): ReturnType<typeof originalUpdateTrayTooltip> => {
  if (!IS_CLI) {
    return originalUpdateTrayTooltip(...args);
  }
};

export type { TrayItem } from "node-tray";
