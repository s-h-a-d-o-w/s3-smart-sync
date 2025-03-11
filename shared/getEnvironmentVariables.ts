// Use for required variables only!
export function getEnvironmentVariables<T extends string>(...names: T[]) {
  const result = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => names.includes(name as T)),
  );

  const missing = names.filter(
    (name) => !Object.keys(result).includes(name) || result[name] === "",
  );
  if (missing.length > 0) {
    if (
      process.platform === "win32" &&
      process.pkg &&
      !process.argv.includes("cli")
    ) {
      import("winax")
        .then((winax) => {
          const wsh = new winax.Object("WScript.Shell");
          wsh["Popup"](
            "Missing environment variable(s): " + missing.join(", "),
            undefined,
            "Critical error",
            48,
          );

          process.exit(1);
        })
        .catch((error) => {
          throw new Error(String(error));
        });
    }

    throw new Error("Missing environment variable(s): " + missing.join(", "));
  }

  return result as Record<T, string>;
}
