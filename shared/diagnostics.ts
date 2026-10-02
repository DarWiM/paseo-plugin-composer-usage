import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Client runtimes (mobile especially) have no console the user can read; events land in `paseo plugin logs`.
export const diagnosticsRpc = defineRpc({
  name: "diagnostics.report",
  input: z.object({ event: z.string(), detail: z.string().optional() }),
  output: z.object({}),
});
