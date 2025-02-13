export function getHeartbeatInterval() {
  return parseInt(process.env["HEARTBEAT_INTERVAL"] || "5000", 10);
}
