import { CLAUDE_NATIVE_EXTENSION_ID } from "@/lib/claude-native-config";
import { adminStartClaudeNativePilot } from "@/lib/claude-native.functions";
export async function launchClaudeNativeAdminPilot() {
  const runtime = (
    window as unknown as {
      chrome?: {
        runtime?: {
          sendMessage: (id: string, message: unknown, callback: (response: any) => void) => void;
          lastError?: { message?: string };
        };
      };
    }
  ).chrome?.runtime;
  if (!runtime?.sendMessage)
    throw new Error(
      "Install the Claude pilot extension in this Chrome profile, then refresh this page.",
    );
  const send = (message: unknown) =>
    new Promise<any>((resolve, reject) => {
      runtime.sendMessage(CLAUDE_NATIVE_EXTENSION_ID, message, (response) => {
        if (runtime.lastError)
          return reject(
            new Error("Claude pilot extension not connected. Install it, then refresh this page."),
          );
        if (!response?.ok)
          return reject(new Error(response?.error ?? "Claude pilot could not start."));
        resolve(response);
      });
    });
  await send({ type: "trst_claude_pilot_ping" });
  const { ticket } = await adminStartClaudeNativePilot();
  const result = await send({ type: "trst_claude_native_pilot", ticket });
  return { mode: result.mode as "existing" | "imported" };
}
