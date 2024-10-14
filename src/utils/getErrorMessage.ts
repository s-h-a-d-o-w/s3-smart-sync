export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.stack;
  }

  return error;
}
