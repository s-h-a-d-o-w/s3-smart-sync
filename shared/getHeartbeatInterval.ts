export function getHeartbeatInterval() {
  return Number.parseInt(process.env["HEARTBEAT_INTERVAL"] || "5000", 10);
}
