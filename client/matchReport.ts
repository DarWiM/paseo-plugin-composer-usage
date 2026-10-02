import type { PluginClientContext } from "@getpaseo/plugin/client";

export type UsageList = Awaited<ReturnType<PluginClientContext["paseo"]["providers"]["listUsage"]>>;
export type UsageReport = UsageList["providers"][number];
// `summary` and `shortLabel` arrive from 0.11 daemons only, and a 0.10 app drops them while parsing.
export type UsageWindow = UsageReport["windows"][number] & { summary?: boolean; shortLabel?: string };
export type Tone = "default" | "ok" | "warning" | "danger";

export interface AgentLike {
  provider: string;
  model: string | null;
}

// Usage report IDs per backend of the multi-provider harnesses (`<backend>/<model>`).
// `omp-*` come from the omp-usage plugin; Paseo has no usage source for Pi's own Antigravity login,
// so Pi's Antigravity agents borrow the omp report (the same Google account when both are logged in).
const HARNESS_BACKENDS: Record<string, Record<string, string[]>> = {
  omp: {
    anthropic: ["claude"],
    "openai-codex": ["codex"],
    "google-antigravity": ["omp-google-antigravity"],
    zai: ["omp-zai", "zai"],
  },
  pi: {
    anthropic: ["claude"],
    "openai-codex": ["codex"],
    antigravity: ["omp-google-antigravity"],
    "google-antigravity": ["omp-google-antigravity"],
    zai: ["zai", "omp-zai"],
  },
};

export function reportCandidates(agent: AgentLike): string[] {
  const backends = HARNESS_BACKENDS[agent.provider];
  if (!backends) return [agent.provider];
  const backend = agent.model?.split("/")[0];
  if (!backend) return [];
  return backends[backend] ?? (agent.provider === "omp" ? [`omp-${backend}`, backend] : [backend]);
}

export function findReport(reports: UsageReport[], agent: AgentLike): UsageReport | null {
  for (const providerId of reportCandidates(agent)) {
    const matching = reports.filter((report) => report.providerId === providerId);
    const report = matching.find((candidate) => candidate.status === "available") ?? matching[0];
    if (report) return report;
  }
  return null;
}

// "Weekly · Fable", "Session · Gemini": the part after the dot names a model-specific quota.
function qualifierOf(usageWindow: UsageWindow): string | null {
  const parts = usageWindow.label.split(" · ");
  return parts.length > 1 ? parts.slice(1).join(" · ") : null;
}

function qualifierMatches(qualifier: string, modelId: string): boolean {
  return qualifier
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.length >= 3 && word !== "shared" && modelId.includes(word));
}

export interface PillWindow {
  window: UsageWindow;
  short: string;
}

// Short names Paseo 0.11 sources send as `shortLabel`; 0.10 reports use the same full labels.
const SHORT_PERIODS: Record<string, string> = { Session: "5h", Weekly: "wk" };

function shortLabelOf(usageWindow: UsageWindow): string {
  if (usageWindow.shortLabel) return usageWindow.shortLabel;
  const [period, ...qualifier] = usageWindow.label.split(" · ");
  if (!Object.hasOwn(SHORT_PERIODS, period)) return usageWindow.label;
  const short = SHORT_PERIODS[period];
  return qualifier.length > 0 ? `${short} ${qualifier.join(" · ")}` : short;
}

function summaryPool(all: UsageWindow[]): UsageWindow[] {
  const flagged = all.filter((usageWindow) => usageWindow.summary);
  if (flagged.length > 0) return flagged;
  // Without summary flags, keep the session and weekly limits, as 0.11 sources flag them.
  const periodic = all.filter((usageWindow) => Object.hasOwn(SHORT_PERIODS, usageWindow.label));
  return periodic.length > 0 ? periodic : all;
}

export function windowsForAgent(report: UsageReport, agent: AgentLike): PillWindow[] {
  const all: UsageWindow[] = report.windows;
  const pool = summaryPool(all);
  const modelId = (agent.model ?? "").toLowerCase();
  const unqualified = pool.filter((usageWindow) => qualifierOf(usageWindow) === null);
  // Model-specific windows ("Weekly · Fable") are often not summary windows, so they are matched across all windows.
  const matched = all.filter((usageWindow) => {
    const qualifier = qualifierOf(usageWindow);
    return qualifier !== null && qualifierMatches(qualifier, modelId);
  });
  let chosen = [...unqualified, ...matched];
  if (chosen.length === 0) {
    const first = pool.map(qualifierOf).find((qualifier) => qualifier !== null);
    chosen = pool.filter((usageWindow) => qualifierOf(usageWindow) === first);
  }
  chosen.sort((a, b) => all.indexOf(a) - all.indexOf(b));
  const stripQualifier = unqualified.length === 0;
  return chosen.map((usageWindow) => {
    const short = shortLabelOf(usageWindow);
    const qualifier = qualifierOf(usageWindow);
    return { window: usageWindow, short: stripQualifier && qualifier ? short.replace(qualifier, "").trim() || short : short };
  });
}

export function pillLabel(windows: PillWindow[]): string {
  return windows
    .map(({ window: usageWindow, short }) => `${short} ${typeof usageWindow.usedPct === "number" ? `${Math.round(usageWindow.usedPct)}%` : "–"}`)
    .join(" · ");
}

// Paseo colors a window without a tone at 70% and 90% used.
export function toneOf(usageWindow: UsageWindow): Tone {
  if (usageWindow.tone) return usageWindow.tone;
  if (typeof usageWindow.usedPct !== "number") return "default";
  if (usageWindow.usedPct > 90) return "danger";
  if (usageWindow.usedPct >= 70) return "warning";
  return "ok";
}

const TONE_RANK: Record<Tone, number> = { default: 0, ok: 1, warning: 2, danger: 3 };

export function worstTone(windows: PillWindow[]): Tone {
  return windows.reduce<Tone>((worst, { window: usageWindow }) => {
    const tone = toneOf(usageWindow);
    return TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst;
  }, "default");
}
