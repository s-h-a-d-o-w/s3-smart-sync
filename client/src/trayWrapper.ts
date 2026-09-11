import { IS_CLI } from "./consts.ts";

type NodeTray = typeof import("node-tray");

let nodeTray: NodeTray | undefined;

// Loaded on demand so that runs without a tray icon (cli, install, uninstall) don't require the native addon's GUI libraries to be present
async function loadNodeTray() {
  nodeTray ??= await import("node-tray");
  return nodeTray;
}

export const createTrayIcon = async (
  ...args: Parameters<NodeTray["createTrayIcon"]>
): ReturnType<NodeTray["createTrayIcon"]> => {
  if (IS_CLI) {
    return;
  }

  return (await loadNodeTray()).createTrayIcon(...args);
};

export const destroyTrayIcon = (
  ...args: Parameters<NodeTray["destroyTrayIcon"]>
) => nodeTray?.destroyTrayIcon(...args);

export const updateTrayIconImage = (
  ...args: Parameters<NodeTray["updateTrayIconImage"]>
) => nodeTray?.updateTrayIconImage(...args);

export const updateTrayItem = (
  ...args: Parameters<NodeTray["updateTrayItem"]>
) => nodeTray?.updateTrayItem(...args);

export const updateTrayTooltip = (
  ...args: Parameters<NodeTray["updateTrayTooltip"]>
) => nodeTray?.updateTrayTooltip(...args);

export type { TrayItem } from "node-tray";
