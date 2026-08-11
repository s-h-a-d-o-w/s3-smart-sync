import { fileExists } from "@s3-smart-sync/shared/fileExists.ts";
import { logger } from "@s3-smart-sync/shared/logger.ts";
import { execFile, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { IS_WINDOWS } from "./consts.ts";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "s3-smart-sync.service";
const SERVICE_PATH = path.join("/etc/systemd/system", SERVICE_NAME);

// In packaged builds, node is copied next to the launcher script
async function getExecutable() {
  if (IS_WINDOWS) {
    throw new Error("Managing a service is only supported on Linux (systemd).");
  }

  const executable = path.join(path.dirname(process.execPath), "s3-smart-sync");
  if (!(await fileExists(executable))) {
    throw new Error(
      `Could not find ${executable}. Run this command from within an extracted release.`,
    );
  }

  return executable;
}

function elevate(executable: string): never {
  logger.info("Managing a system service requires root, elevating via sudo…");

  const { error, status } = spawnSync(
    "sudo",
    [executable, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  if (error) {
    throw new Error(
      `Could not elevate via sudo (${error.message}). Please run this command as root.`,
    );
  }

  process.exit(status ?? 1);
}

export async function installService() {
  const executable = await getExecutable();
  if (process.getuid?.() !== 0) {
    elevate(executable);
  }

  // Under sudo, the service has to run as the user who invoked it, not as root
  const user = process.env["SUDO_USER"] ?? userInfo().username;
  const unit = `[Unit]
Description=S3 Smart Sync
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${path.dirname(executable)}
ExecStart=${executable} cli
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

  await writeFile(SERVICE_PATH, unit, { mode: 0o644 });
  logger.info(`Created ${SERVICE_PATH}`);

  await execFileAsync("systemctl", ["daemon-reload"]);
  await execFileAsync("systemctl", ["enable", "--now", SERVICE_NAME]);
  logger.info(`Enabled and started ${SERVICE_NAME} (running as ${user})`);

  logger.info(`Logs: journalctl -u ${SERVICE_NAME} -f`);
}

export async function uninstallService() {
  const executable = await getExecutable();
  if (process.getuid?.() !== 0) {
    elevate(executable);
  }

  if (!(await fileExists(SERVICE_PATH))) {
    logger.info(`${SERVICE_NAME} is not installed.`);
    return;
  }

  await execFileAsync("systemctl", ["disable", "--now", SERVICE_NAME]);
  await rm(SERVICE_PATH);
  await execFileAsync("systemctl", ["daemon-reload"]);
  logger.info(`Stopped ${SERVICE_NAME} and removed ${SERVICE_PATH}`);
}
