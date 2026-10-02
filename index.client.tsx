import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { type AgentLike, findReport, pillLabel, reportCandidates, windowsForAgent } from "./client/matchReport";
import { createUsageIcon, createUsagePopover } from "./client/usagePill";
import { createUsageStore } from "./client/usageStore";
import { diagnosticsRpc } from "./shared/diagnostics";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const REFRESH_MS = 60_000;

interface AgentSnapshot extends AgentLike {
  id: string;
  workspaceId?: string | null;
  status?: string;
  archivedAt?: string | null;
}

interface Pill {
  registration: PluginButtonRegistration;
  agent: AgentLike;
  workspaceId: string;
  label: string;
  visible: boolean;
}

export default function contribute(client: PluginClientContext) {
  const store = createUsageStore(() => client.paseo.providers.listUsage());
  const pills = new Map<string, Pill>();
  const statuses = new Map<string, string>();
  const lifetime = new AbortController();
  let stopped = false;

  const report = (event: string, detail?: string) => {
    void client.rpc(diagnosticsRpc, { event, detail }).catch(() => undefined);
  };
  report("started", `${Platform.OS}`);

  // Hidden until a report matches, so agents without a usage source get no pill.
  const presentation = (agent: AgentLike): { label: string; visible: boolean } => {
    const state = store.get();
    if (state.status === "error" && !state.list) return { label: "Usage unavailable", visible: reportCandidates(agent).length > 0 };
    const report = state.status === "loading" || !state.list ? null : findReport(state.list.providers, agent);
    if (!report) return { label: "Usage", visible: false };
    const windows = windowsForAgent(report, agent);
    if (windows.length === 0) return { label: report.status === "available" ? "No limits" : "Usage unavailable", visible: report.status !== "available" };
    return { label: pillLabel(windows), visible: true };
  };

  let lastOutcome = "";
  const reportOutcome = () => {
    const state = store.get();
    if (state.status === "loading" || state.refreshing) return;
    const outcome =
      state.status === "error"
        ? `usage error: ${state.error}`
        : `usage ok: ${state.list.providers.map((entry) => `${entry.providerId}/${entry.status}`).join(", ") || "no reports"}`;
    if (outcome === lastOutcome) return;
    lastOutcome = outcome;
    const visible = [...pills.values()].filter((pill) => pill.visible).length;
    report(outcome, `${visible} of ${pills.size} pills visible`);
  };

  // Pill labels are plain strings, so they are pushed with update() whenever the usage list changes.
  const unsubscribeStore = store.subscribe(() => {
    for (const pill of pills.values()) {
      const { label, visible } = presentation(pill.agent);
      if (label === pill.label && visible === pill.visible) continue;
      pill.label = label;
      pill.visible = visible;
      pill.registration.update({ label, visible });
    }
    reportOutcome();
  });

  const removePill = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
    statuses.delete(agentId);
  };

  const upsert = (snapshot: AgentSnapshot) => {
    if (stopped) return;
    const workspaceId = snapshot.workspaceId;
    if (!workspaceId || snapshot.archivedAt) {
      removePill(snapshot.id);
      return;
    }
    const previousStatus = statuses.get(snapshot.id);
    if (snapshot.status) statuses.set(snapshot.id, snapshot.status);
    if (previousStatus === "running" && snapshot.status !== "running") void store.refresh();

    const existing = pills.get(snapshot.id);
    if (
      existing &&
      existing.agent.provider === snapshot.provider &&
      existing.agent.model === snapshot.model &&
      existing.workspaceId === workspaceId
    )
      return;
    existing?.registration.remove();
    const agent: AgentLike = { provider: snapshot.provider, model: snapshot.model };
    const { label, visible } = presentation(agent);
    try {
      const registration = client.addComposerPill({
        id: "usage",
        workspaceId,
        agentId: snapshot.id,
        button: {
          title: "Plan usage",
          icon: createUsageIcon(store, agent),
          label,
          visible,
          behavior: { kind: "popover", Content: createUsagePopover(store, agent) },
        },
      });
      pills.set(snapshot.id, { registration, agent, workspaceId, label, visible });
    } catch (error) {
      report("pill registration failed", `${snapshot.provider}/${snapshot.model ?? "-"}: ${errorText(error)}`);
    }
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          const present = new Set(entries.map(({ agent }) => agent.id));
          for (const agentId of [...pills.keys()]) if (!present.has(agentId)) removePill(agentId);
          for (const { agent } of entries) upsert(agent);
          report("agents snapshot", `${entries.length} agents, ${pills.size} pills`);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") removePill(update.agentId);
          else upsert(update.agent);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!stopped) report("agent observation failed", errorText(error));
    });

  void store.refresh();
  const timer = setInterval(() => void store.refresh(), REFRESH_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    lifetime.abort();
    unsubscribeStore();
    store.stop();
    for (const agentId of [...pills.keys()]) removePill(agentId);
  };
}
