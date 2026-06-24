import { execa } from "execa";

function showMessageBoxWindows(message: string, kind: "error" | "info") {
  const image = kind === "error" ? "Error" : "Information";

  return Promise.all([
    execa(
      `powershell -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${message}', 'ring-notifier', 'OK', '${image}')"`,
    ),
    // Bring message box to the front
    new Promise<void>((resolve) => {
      setTimeout(async () => {
        await execa(
          `powershell "(New-Object -ComObject wscript.shell).AppActivate('ring-notifier')"`,
        );
        resolve();
        // It can take a while for the popup to actually be generated
      }, 1000);
    }),
  ]);
}

function showMessageBoxLinux(message: string, kind: "error" | "info") {
  return execa("zenity", [
    kind === "error" ? "--error" : "--info",
    "--title",
    "ring-notifier",
    "--text",
    message,
  ]).catch(() =>
    execa("xmessage", ["-center", "-title", "ring-notifier", message]),
  );
}

export function showMessageBox(message: string, kind: "error" | "info" = "info") {
  if (process.platform === "win32") {
    return showMessageBoxWindows(message, kind);
  }

  return showMessageBoxLinux(message, kind);
}
