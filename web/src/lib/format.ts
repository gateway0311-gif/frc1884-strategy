import type { MetricDef } from "@shared/games/index";

export function formatMetric(metric: Pick<MetricDef, "percent" | "decimals">, value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  if (metric.percent) return `${Math.round(value * 100)}%`;
  return value.toFixed(metric.decimals ?? 1).replace(/\.0+$/, "");
}

export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return "–";
  return value.toFixed(decimals).replace(/\.0+$/, "");
}
