export function getHeartbeatInterval() {
  return Math.trunc(Number(process.env["HEARTBEAT_INTERVAL"] ?? "5000"));
}
