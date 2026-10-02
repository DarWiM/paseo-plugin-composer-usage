import type { PluginButtonContentProps, PluginButtonIconProps } from "@getpaseo/plugin/client";
import { type ComponentType, useMemo, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { type AgentLike, findReport, type Tone, toneOf, windowsForAgent, worstTone } from "./matchReport";
import type { UsageStore } from "./usageStore";

type ThemeColors = PluginButtonIconProps["theme"]["colors"];

function toneColor(tone: Tone, colors: ThemeColors, fallback: string): string {
  if (tone === "danger") return colors.statusDanger;
  if (tone === "warning") return colors.statusWarning;
  if (tone === "ok") return colors.statusSuccess;
  return fallback;
}

function formatResetIn(resetsAt: string | null | undefined, now: number): string | null {
  if (!resetsAt) return null;
  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60_000));
  if (minutes < 1) return "resets in <1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `resets in ${days}d ${hours}h`;
  if (hours > 0) return `resets in ${hours}h ${minutes % 60}m`;
  return `resets in ${minutes}m`;
}

function useUsage(store: UsageStore) {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function createUsageIcon(store: UsageStore, agent: AgentLike): ComponentType<PluginButtonIconProps> {
  return function UsagePillIcon(props: PluginButtonIconProps) {
    const { size, color, theme } = props;
    const state = useUsage(store);
    const report = state.status === "loading" || !state.list ? null : findReport(state.list.providers, agent);
    const tone = report ? worstTone(windowsForAgent(report, agent)) : "default";
    const dot = Math.round(size * 0.55);
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: toneColor(tone, theme.colors, color) }} />
      </View>
    );
  };
}

export function createUsagePopover(store: UsageStore, agent: AgentLike): ComponentType<PluginButtonContentProps> {
  return function UsagePillPopover(props: PluginButtonContentProps) {
    const { theme } = props;
    const colors = theme.colors;
    const state = useUsage(store);
    const styles = useMemo(
      () => ({
        root: { gap: 12, minWidth: 260 },
        header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
        title: { color: colors.foreground, fontSize: 15, fontWeight: "600" as const },
        plan: { color: colors.foregroundMuted, fontSize: 12 },
        muted: { color: colors.foregroundMuted, fontSize: 12 },
        row: { gap: 4 },
        rowHeader: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: 12 },
        label: { color: colors.foregroundMuted, fontSize: 13 },
        spent: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const },
        track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" as const },
        footer: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
        refresh: { color: colors.foreground, fontSize: 12 },
        error: { color: colors.statusDanger, fontSize: 12 },
      }),
      [colors],
    );
    if (state.status === "loading") return <Text style={styles.muted}>Loading usage…</Text>;
    const report = state.list ? findReport(state.list.providers, agent) : null;
    const spent = new Set(report ? windowsForAgent(report, agent).map(({ window: usageWindow }) => usageWindow.id) : []);
    const fetchedAt = report?.fetchedAt ?? state.list?.fetchedAt;
    const now = Date.now();
    return (
      <View style={styles.root}>
        {report ? (
          <View style={styles.header}>
            <Text style={styles.title}>{report.displayName}</Text>
            {report.planLabel ? <Text style={styles.plan}>{report.planLabel}</Text> : null}
          </View>
        ) : null}
        {report?.windows.map((usageWindow) => {
          const pct = typeof usageWindow.usedPct === "number" ? Math.min(100, Math.max(0, usageWindow.usedPct)) : null;
          const reset = formatResetIn(usageWindow.resetsAt, now);
          const textStyle = spent.has(usageWindow.id) ? styles.spent : styles.label;
          return (
            <View key={usageWindow.id} style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={textStyle}>{usageWindow.label}</Text>
                <Text style={textStyle}>{pct === null ? "–" : `${Math.round(pct)}% used`}</Text>
              </View>
              <View style={styles.track}>
                <View style={{ width: `${pct ?? 0}%`, height: 4, backgroundColor: toneColor(toneOf(usageWindow), colors, colors.foregroundMuted) }} />
              </View>
              {reset ? <Text style={styles.muted}>{reset}</Text> : null}
            </View>
          );
        })}
        {report?.error ? <Text style={styles.error}>{report.error}</Text> : null}
        {state.status === "error" ? <Text style={styles.error}>{state.error}</Text> : null}
        <View style={styles.footer}>
          <Text style={styles.muted}>
            {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh usage" disabled={state.refreshing} onPress={() => void store.refresh()}>
            <Text style={styles.refresh}>{state.refreshing ? "Refreshing…" : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>
    );
  };
}
