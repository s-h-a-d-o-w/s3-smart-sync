// Use for required variables only!
export function getEnvironmentVariables<T extends string>(...names: T[]) {
  const result = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => names.includes(name as T)),
  );

  const missing = names.filter(
    (name) => !Object.keys(result).includes(name) || result[name] === "",
  );
  if (missing.length > 0) {
    throw new Error("Missing variable(s): " + missing.join(", "));
  }

  return result as Record<T, string>;
}
