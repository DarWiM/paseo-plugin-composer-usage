import type { PluginServerContext } from "@getpaseo/plugin/server";
import { diagnosticsRpc } from "./shared/diagnostics";

export default function contribute(server: PluginServerContext) {
  server.handle(diagnosticsRpc, ({ event, detail }) => {
    console.log(`[client] ${event}${detail ? `: ${detail}` : ""}`);
    return {};
  });
  return () => {};
}
