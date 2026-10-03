import type { FieldDefinition, PlanMatch, Point } from "./index";

// The REBUILT field, drawn to scale from the game manual dimensions (inches,
// scaled to a 720-wide drawing). Carried over from the original strategy page.
const FW = 720;
const FH = 351;
const sc = (v: number) => (v * FW) / 651.2;
const WALL = 10;
const DSH = FH / 3;
const R1Y = DSH / 2, R2Y = DSH + DSH / 2, R3Y = DSH * 2 + DSH / 2;
const B3Y = DSH / 2, B2Y = DSH + DSH / 2, B1Y = DSH * 2 + DSH / 2;
const RED_DEPOT_CY = (R1Y + R2Y) / 2, RED_TOWER_CY = (R2Y + R3Y) / 2, RED_OUTPOST_CY = R3Y + (FH - R3Y) * 0.55;
const BLUE_OUTPOST_CY = R1Y * 0.45, BLUE_TOWER_CY = (B3Y + B2Y) / 2, BLUE_DEPOT_CY = (B2Y + B1Y) / 2;
const DEPOT_W = sc(27), DEPOT_H = sc(42), TOWER_W = sc(45), TOWER_H = sc(49.25), OUTPOST_W = sc(36), OUTPOST_H = sc(38);
const HUB_W = sc(47), HUB_H = sc(47), RED_HUB_X = sc(158.6), BLUE_HUB_X = sc(651.2 - 158.6), HUB_CY = FH / 2;
const BUMP_DX = sc(44.4), BUMP_DY = sc(73), TRENCH_DX = sc(65.65), TRENCH_DY = sc(47);

function fuelDots(x0: number, y0: number, bw: number, bh: number, n: number): Array<[number, number]> {
  const cols = Math.round(Math.sqrt((n * bw) / bh));
  const rows = Math.ceil(n / cols);
  const gx = bw / (cols + 1), gy = bh / (rows + 1);
  const dots: Array<[number, number]> = [];
  for (let r = 1, c = 0; r <= rows && c < n; r++) for (let col = 1; col <= cols && c < n; col++, c++) dots.push([x0 + col * gx, y0 + r * gy]);
  return dots;
}

function Background() {
  const fBW = sc(88), fBH = sc(148), gap = sc(18), fBY = (FH - fBH) / 2;
  const fLx = FW / 2 - gap / 2 - fBW, fRx = FW / 2 + gap / 2;
  const dots = [...fuelDots(fLx, fBY, fBW, fBH, 125), ...fuelDots(fRx, fBY, fBW, fBH, 125)];
  const zones = [sc(60), sc(100), sc(145), sc(200)];
  const zoneColors = ["#dc2626", "#ea580c", "#ca8a04", "#16a34a"];
  const zoneOpacity = [0.22, 0.15, 0.11, 0.08];
  const arc = (hx: number, r: number, sweep: 0 | 1, close: boolean) => `M ${hx},${HUB_CY - r} A ${r},${r} 0 0,${sweep} ${hx},${HUB_CY + r}${close ? " Z" : ""}`;
  return (
    <>
      <rect x={0} y={0} width={RED_HUB_X} height={FH} fill="#fff0f0" />
      <rect x={RED_HUB_X} y={0} width={BLUE_HUB_X - RED_HUB_X} height={FH} fill="#f0f5ee" />
      <rect x={BLUE_HUB_X} y={0} width={FW - BLUE_HUB_X} height={FH} fill="#f0f0ff" />
      <rect x={0} y={0} width={WALL} height={FH} fill="#bbb" />
      <rect x={FW - WALL} y={0} width={WALL} height={FH} fill="#bbb" />
      {[0, 1, 2].map((i) => {
        const cy = DSH * i + DSH / 2;
        return (
          <g key={i}>
            <text x={WALL / 2} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#991b1b" fontWeight={900} transform={`rotate(-90,${WALL / 2},${cy})`}>
              R{i + 1}
            </text>
            <text x={FW - WALL / 2} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#1e3a8a" fontWeight={900} transform={`rotate(90,${FW - WALL / 2},${cy})`}>
              {["B3", "B2", "B1"][i]}
            </text>
          </g>
        );
      })}
      {/* Depots, towers and outposts */}
      <rect x={WALL} y={RED_DEPOT_CY - DEPOT_H / 2} width={DEPOT_W} height={DEPOT_H} fill="#fef08a" stroke="#dc2626" strokeWidth={1.5} rx={2} />
      <text x={WALL + DEPOT_W + 3} y={RED_DEPOT_CY} dominantBaseline="middle" fontSize={6} fill="#dc2626" fontWeight={700}>DEPOT</text>
      <rect x={WALL} y={RED_TOWER_CY - TOWER_H / 2} width={TOWER_W} height={TOWER_H} fill="#dc2626" stroke="#7f1d1d" strokeWidth={1.5} rx={2} />
      <text x={WALL + TOWER_W / 2} y={RED_TOWER_CY} textAnchor="middle" dominantBaseline="middle" fontSize={6.5} fill="#fff" fontWeight={900} transform={`rotate(-90,${WALL + TOWER_W / 2},${RED_TOWER_CY})`}>TOWER</text>
      <rect x={WALL} y={RED_OUTPOST_CY - OUTPOST_H / 2} width={OUTPOST_W} height={OUTPOST_H} fill="#1e293b" stroke="#64748b" strokeWidth={1.5} rx={2} />
      <text x={WALL + OUTPOST_W / 2} y={RED_OUTPOST_CY} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill="#94a3b8" fontWeight={700} transform={`rotate(-90,${WALL + OUTPOST_W / 2},${RED_OUTPOST_CY})`}>OUTPOST</text>
      <rect x={FW - WALL - OUTPOST_W} y={BLUE_OUTPOST_CY - OUTPOST_H / 2} width={OUTPOST_W} height={OUTPOST_H} fill="#1e293b" stroke="#64748b" strokeWidth={1.5} rx={2} />
      <text x={FW - WALL - OUTPOST_W / 2} y={BLUE_OUTPOST_CY} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill="#94a3b8" fontWeight={700} transform={`rotate(90,${FW - WALL - OUTPOST_W / 2},${BLUE_OUTPOST_CY})`}>OUTPOST</text>
      <rect x={FW - WALL - TOWER_W} y={BLUE_TOWER_CY - TOWER_H / 2} width={TOWER_W} height={TOWER_H} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={1.5} rx={2} />
      <text x={FW - WALL - TOWER_W / 2} y={BLUE_TOWER_CY} textAnchor="middle" dominantBaseline="middle" fontSize={6.5} fill="#fff" fontWeight={900} transform={`rotate(90,${FW - WALL - TOWER_W / 2},${BLUE_TOWER_CY})`}>TOWER</text>
      <rect x={FW - WALL - DEPOT_W} y={BLUE_DEPOT_CY - DEPOT_H / 2} width={DEPOT_W} height={DEPOT_H} fill="#fef08a" stroke="#1d4ed8" strokeWidth={1.5} rx={2} />
      <text x={FW - WALL - DEPOT_W - 3} y={BLUE_DEPOT_CY} textAnchor="end" dominantBaseline="middle" fontSize={6} fill="#1d4ed8" fontWeight={700}>DEPOT</text>
      {/* Zone and centre lines */}
      <line x1={RED_HUB_X} y1={0} x2={RED_HUB_X} y2={FH} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.6} />
      <line x1={BLUE_HUB_X} y1={0} x2={BLUE_HUB_X} y2={FH} stroke="#1d4ed8" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.6} />
      <line x1={FW / 2} y1={0} x2={FW / 2} y2={FH} stroke="#666" strokeWidth={1.5} strokeDasharray="8,5" opacity={0.4} />
      {/* Trenches and bumps */}
      {[{ hx: RED_HUB_X, col: "#b91c1c" }, { hx: BLUE_HUB_X, col: "#1d4ed8" }].map(({ hx, col }) => (
        <g key={hx}>
          <rect x={hx - TRENCH_DX / 2} y={0} width={TRENCH_DX} height={TRENCH_DY} fill={col} opacity={0.8} rx={2} />
          <text x={hx} y={TRENCH_DY / 2} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#fff" fontWeight={700}>TRENCH</text>
          <rect x={hx - TRENCH_DX / 2} y={FH - TRENCH_DY} width={TRENCH_DX} height={TRENCH_DY} fill={col} opacity={0.8} rx={2} />
          <text x={hx} y={FH - TRENCH_DY / 2} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#fff" fontWeight={700}>TRENCH</text>
        </g>
      ))}
      {[RED_HUB_X - BUMP_DX, BLUE_HUB_X].map((bx) => (
        <g key={bx}>
          <rect x={bx} y={HUB_CY - HUB_H / 2 - BUMP_DY} width={BUMP_DX} height={BUMP_DY} fill="#ea580c" rx={2} opacity={0.85} />
          <text x={bx + BUMP_DX / 2} y={HUB_CY - HUB_H / 2 - BUMP_DY / 2} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#fff" fontWeight={700}>BUMP</text>
          <rect x={bx} y={HUB_CY + HUB_H / 2} width={BUMP_DX} height={BUMP_DY} fill="#ea580c" rx={2} opacity={0.85} />
          <text x={bx + BUMP_DX / 2} y={HUB_CY + HUB_H / 2 + BUMP_DY / 2} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#fff" fontWeight={700}>BUMP</text>
        </g>
      ))}
      {/* Fuel in the neutral zone */}
      <rect x={fLx} y={fBY} width={fBW} height={fBH} fill="#fefce8" stroke="#d97706" strokeWidth={1} rx={2} />
      <rect x={fRx} y={fBY} width={fBW} height={fBH} fill="#fefce8" stroke="#d97706" strokeWidth={1} rx={2} />
      {dots.map(([dx, dy], i) => (
        <circle key={i} cx={dx} cy={dy} r={2.2} fill="#d97706" opacity={0.85} />
      ))}
      {/* Shooting distance bands around each hub */}
      {[3, 2, 1, 0].map((i) => (
        <g key={i}>
          <path d={arc(RED_HUB_X, zones[i], 0, true)} fill={zoneColors[i]} opacity={zoneOpacity[i]} />
          <path d={arc(RED_HUB_X, zones[i], 0, false)} fill="none" stroke={zoneColors[i]} strokeWidth={1.5} strokeDasharray={i === 0 ? undefined : "5,3"} opacity={0.75} />
          <path d={arc(BLUE_HUB_X, zones[i], 1, true)} fill={zoneColors[i]} opacity={zoneOpacity[i]} />
          <path d={arc(BLUE_HUB_X, zones[i], 1, false)} fill="none" stroke={zoneColors[i]} strokeWidth={1.5} strokeDasharray={i === 0 ? undefined : "5,3"} opacity={0.75} />
        </g>
      ))}
      {/* Hubs */}
      {[{ hx: RED_HUB_X, fill: "#fecaca", stroke: "#7f1d1d", hex: "#dc2626", label: "RED HUB" }, { hx: BLUE_HUB_X, fill: "#bfdbfe", stroke: "#1e3a8a", hex: "#1d4ed8", label: "BLUE HUB" }].map(({ hx, fill, stroke, hex, label }) => (
        <g key={label}>
          <rect x={hx - HUB_W / 2} y={HUB_CY - HUB_H / 2} width={HUB_W} height={HUB_H} fill={fill} stroke={stroke} strokeWidth={2.5} rx={4} />
          <polygon points={`${hx},${HUB_CY - 12} ${hx + 12},${HUB_CY - 6} ${hx + 12},${HUB_CY + 6} ${hx},${HUB_CY + 12} ${hx - 12},${HUB_CY + 6} ${hx - 12},${HUB_CY - 6}`} fill={hex} />
          <text x={hx} y={HUB_CY} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill="#fff" fontWeight={900}>HUB</text>
        </g>
      ))}
      <text x={RED_HUB_X / 2} y={14} textAnchor="middle" fontSize={7} fill="#dc2626" opacity={0.6} fontWeight={700}>RED ZONE</text>
      <text x={FW / 2} y={14} textAnchor="middle" fontSize={7} fill="#166534" opacity={0.6} fontWeight={700}>NEUTRAL ZONE</text>
      <text x={(BLUE_HUB_X + FW) / 2} y={14} textAnchor="middle" fontSize={7} fill="#1d4ed8" opacity={0.6} fontWeight={700}>BLUE ZONE</text>
      <rect x={0} y={0} width={FW} height={FH} fill="none" stroke="#444" strokeWidth={3} />
    </>
  );
}

function defaultPositions(match: PlanMatch): Record<number, Point> {
  const positions: Record<number, Point> = {};
  match.red.forEach((team, i) => {
    positions[team] = { x: RED_HUB_X - sc(40), y: [R1Y, R2Y, R3Y][i] ?? R2Y };
  });
  match.blue.forEach((team, i) => {
    positions[team] = { x: BLUE_HUB_X + sc(40), y: [B1Y, B2Y, B3Y][i] ?? B2Y };
  });
  return positions;
}

export const rebuilt2026Field: FieldDefinition = {
  width: FW,
  height: FH,
  Background,
  defaultPositions,
  legend: "Orange is a bump, the coloured strips at top and bottom are trenches, yellow is a depot. The arcs show shooting distance from each hub.",
};
