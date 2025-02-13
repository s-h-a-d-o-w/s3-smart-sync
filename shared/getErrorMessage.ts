export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message;
  } else if (typeof error === "string") {
    return error;
  } else {
    try {
      return JSON.stringify(error, null, 2);
    } catch (_) {
      return "Error cannot be converted to string!";
    }
  }
}
