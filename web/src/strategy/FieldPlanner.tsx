import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldDefinition, PlanMatch, Point } from "../games";

export interface Stroke {
  pts: Point[];
  color: string;
  width: number;
}

export interface PhasePlan {
  pos: Record<string, Point>;
  strokes: Stroke[];
  notes: string;
}

export const EMPTY_PHASE: PhasePlan = { pos: {}, strokes: [], notes: "" };

const COLORS = [
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "blue", label: "Blue", hex: "#60a5fa" },
  { id: "yellow", label: "Yellow", hex: "#facc15" },
];

type Tool = "move" | "draw" | "erase";

// One field: drag the robots, sketch paths over the top.
// Carried over from the original strategy page and made touch-first.
export function FieldPlanner({ field, match, ourTeam, plan, onChange }: { field: FieldDefinition; match: PlanMatch; ourTeam: number; plan: PhasePlan; onChange: (next: PhasePlan) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [color, setColor] = useState(COLORS[2].hex);
  const [active, setActive] = useState<Point[] | null>(null);
  const [drag, setDrag] = useState<{ team: number; dx: number; dy: number; at: Point } | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;

  const teams = [...match.red, ...match.blue];
  const defaults = field.defaultPositions(match);
  const position = (team: number): Point => (drag?.team === team ? drag.at : (plan.pos[String(team)] ?? defaults[team] ?? { x: field.width / 2, y: field.height / 2 }));

  const toField = useCallback(
    (event: React.PointerEvent): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: ((event.clientX - rect.left) * field.width) / rect.width, y: ((event.clientY - rect.top) * field.height) / rect.height };
    },
    [field]
  );

  function hit(point: Point): number | null {
    for (const team of teams) {
      const p = position(team);
      if (Math.hypot(point.x - p.x, point.y - p.y) < 24) return team;
    }
    return null;
  }

  function down(event: React.PointerEvent) {
    const point = toField(event);
    const team = hit(point);
    // Grabbing a robot always wins, whatever tool is selected.
    if (team !== null) {
      const p = position(team);
      setDrag({ team, dx: point.x - p.x, dy: point.y - p.y, at: p });
      svgRef.current?.setPointerCapture(event.pointerId);
    } else if (tool === "draw") {
      setActive([point]);
      svgRef.current?.setPointerCapture(event.pointerId);
    } else if (tool === "erase") {
      onChange({ ...plan, strokes: plan.strokes.filter((stroke) => !stroke.pts.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 14)) });
    }
  }

  function move(event: React.PointerEvent) {
    if (drag) {
      const point = toField(event);
      setDrag({ ...drag, at: { x: Math.max(14, Math.min(field.width - 14, point.x - drag.dx)), y: Math.max(14, Math.min(field.height - 14, point.y - drag.dy)) } });
    } else if (active) {
      const point = toField(event);
      const last = active[active.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 2) setActive([...active, point]);
    }
  }

  function up() {
    if (drag) {
      onChange({ ...planRef.current, pos: { ...planRef.current.pos, [String(drag.team)]: drag.at } });
      setDrag(null);
    } else if (active) {
      if (active.length > 1) onChange({ ...planRef.current, strokes: [...planRef.current.strokes, { pts: active, color, width: 3.5 }] });
      setActive(null);
    }
  }

  // Leaving the page mid-drag must not leave a robot stuck to the pointer.
  useEffect(() => () => setDrag(null), []);

  const strokes = active ? [...plan.strokes, { pts: active, color, width: 3.5 }] : plan.strokes;

  return (
    <div className="planner">
      <div className="planner-tools" role="toolbar" aria-label="Field tools">
        <button type="button" className={`pill${tool === "move" ? " is-on" : ""}`} aria-pressed={tool === "move"} onClick={() => setTool("move")}>
          Move robots
        </button>
        <button type="button" className={`pill${tool === "draw" ? " is-on" : ""}`} aria-pressed={tool === "draw"} onClick={() => setTool("draw")}>
          Draw
        </button>
        {COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`swatch${tool === "draw" && color === c.hex ? " is-on" : ""}`}
            style={{ background: c.hex }}
            aria-label={`Draw in ${c.label.toLowerCase()}`}
            onClick={() => {
              setColor(c.hex);
              setTool("draw");
            }}
          />
        ))}
        <button type="button" className={`pill${tool === "erase" ? " is-on" : ""}`} aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>
          Erase a line
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onChange({ ...plan, strokes: [] })} disabled={plan.strokes.length === 0}>
          Clear lines
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onChange({ ...plan, pos: {}, strokes: [] })}>
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        className={`planner-field planner-${tool}`}
        viewBox={`0 0 ${field.width} ${field.height}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="img"
        aria-label="Field with the six robots. Drag a robot to place it."
      >
        <field.Background />
        {strokes.map((stroke, i) =>
          stroke.pts.length < 2 ? null : (
            <path key={i} d={stroke.pts.map((p, j) => `${j === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
          )
        )}
        {teams.map((team) => {
          const p = position(team);
          const red = match.red.includes(team);
          const index = (red ? match.red : match.blue).indexOf(team);
          const ours = team === ourTeam;
          const text = String(team);
          return (
            <g key={team} className="planner-robot">
              <circle cx={p.x + 2} cy={p.y + 2} r={16} fill="rgba(0,0,0,0.18)" />
              <circle cx={p.x} cy={p.y} r={16} fill={ours ? "#facc15" : red ? "#ef4444" : "#3b82f6"} stroke={drag?.team === team ? "#fff" : "rgba(0,0,0,0.3)"} strokeWidth={drag?.team === team ? 2.5 : 1.5} />
              {ours ? <circle cx={p.x} cy={p.y} r={20} fill="none" stroke="#facc15" strokeWidth={2} opacity={0.5} /> : null}
              <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={text.length > 4 ? 7 : 8} fill={ours ? "#000" : "#fff"} fontWeight={900}>
                {text}
              </text>
              <circle cx={p.x + 13} cy={p.y - 13} r={7} fill={red ? "#991b1b" : "#1e3a8a"} stroke="#fff" strokeWidth={1} />
              <text x={p.x + 13} y={p.y - 13} textAnchor="middle" dominantBaseline="middle" fontSize={6} fill="#fff" fontWeight={900}>
                {red ? "R" : "B"}
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
      {field.legend ? <p className="panel-note">{field.legend}</p> : null}
    </div>
  );
}
