import { useState } from "react";

// One series, one hue: a team's value in each match it played.
// Bars carry no numbers; hover or focus a bar to read it, and the match
// history table below the chart is the table view of the same data.

export interface Bar {
  label: string;
  value: number | null;
  detail?: string;
}

export function BarChart({ bars, format, title }: { bars: Bar[]; format: (v: number) => string; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 640;
  const height = 200;
  const pad = { top: 14, right: 8, bottom: 26, left: 36 };
  const values = bars.map((b) => b.value ?? 0);
  const top = niceMax(Math.max(1, ...values));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = innerW / Math.max(1, bars.length);
  const barW = Math.min(36, step - 2);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const ticks = [0, top / 2, top];
  const shown = active !== null ? bars[active] : null;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}, one bar per match`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
            <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" className="chart-axis">
              {format(tick)}
            </text>
          </g>
        ))}
        {bars.map((bar, i) => {
          const x = pad.left + i * step + (step - barW) / 2;
          const h = bar.value === null ? 0 : Math.max(2, y(0) - y(bar.value));
          const showLabel = bars.length <= 12 || i % Math.ceil(bars.length / 12) === 0;
          return (
            <g key={bar.label} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} tabIndex={0}>
              {/* A hit area taller and wider than the bar itself. */}
              <rect x={pad.left + i * step} y={pad.top} width={step} height={innerH} fill="transparent" />
              {bar.value === null ? (
                <text x={x + barW / 2} y={y(0) - 6} textAnchor="middle" className="chart-axis">
                  –
                </text>
              ) : (
                <path d={roundedTop(x, y(0) - h, barW, h, Math.min(4, barW / 2, h))} className={active === i ? "chart-bar is-active" : "chart-bar"} />
              )}
              {showLabel ? (
                <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="chart-axis">
                  {bar.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="chart-base" />
      </svg>
      <figcaption className="chart-readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{shown.label}</strong> {shown.value === null ? "not recorded" : format(shown.value)}
            {shown.detail ? <span className="dim"> {shown.detail}</span> : null}
          </>
        ) : (
          <span className="dim">Point at a bar to read it.</span>
        )}
      </figcaption>
    </figure>
  );
}

function niceMax(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

// A bar with rounded top corners and a square base sitting on the axis.
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
