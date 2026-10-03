import { useEffect, useState } from "react";
import { Page, Panel } from "../components/ui";
import { getField } from "../games";
import { useSchedule, useTeams } from "../lib/data";
import { useSession } from "../lib/session";
import { EMPTY_PHASE, FieldPlanner, type PhasePlan } from "./FieldPlanner";

interface BoardState {
  red: Array<number | null>;
  blue: Array<number | null>;
  plan: PhasePlan;
}

const KEY = "hub-free-board-v1";
const BLANK: BoardState = { red: [null, null, null], blue: [null, null, null], plan: EMPTY_PHASE };

function load(): BoardState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as BoardState | null;
    if (saved && Array.isArray(saved.red) && Array.isArray(saved.blue)) return { ...BLANK, ...saved };
  } catch {
    // Start with a blank board.
  }
  return BLANK;
}

// A blank field for trying ideas with any six teams. Kept on this device only.
export function FreeBoard() {
  const { game } = useSession();
  const teams = useTeams();
  const schedule = useSchedule();
  const [board, setBoard] = useState<BoardState>(load);
  const field = getField(game.id);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(board));
    } catch {
      // The board still works for this visit.
    }
  }, [board]);

  const chosen = new Set([...board.red, ...board.blue].filter((n): n is number => n !== null));
  const pick = (side: "red" | "blue", index: number, value: string) => {
    const next = [...board[side]];
    next[index] = value ? Number(value) : null;
    setBoard({ ...board, [side]: next });
  };
  const match = { red: board.red.filter((n): n is number => n !== null), blue: board.blue.filter((n): n is number => n !== null) };

  return (
    <Page title="Free strategy board" lead="Pick any six teams and sketch an idea. This board stays on this device." back="/more" wide>
      <div className="split">
        {(["red", "blue"] as const).map((side) => (
          <Panel key={side} tone={side} title={side === "red" ? "Red alliance" : "Blue alliance"}>
            <div className="form-grid">
              {[0, 1, 2].map((index) => (
                <label key={index} className="field">
                  <span>
                    {side === "red" ? "Red" : "Blue"} {index + 1}
                  </span>
                  <select value={board[side][index] ?? ""} onChange={(e) => pick(side, index, e.target.value)}>
                    <option value="">Empty</option>
                    {(teams.data?.teams ?? []).map((team) => (
                      <option key={team.teamNumber} value={team.teamNumber} disabled={chosen.has(team.teamNumber) && board[side][index] !== team.teamNumber}>
                        {team.teamNumber} {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <Panel>
        <FieldPlanner field={field} match={match} ourTeam={schedule.data?.ourTeam ?? 1884} plan={board.plan} onChange={(plan) => setBoard({ ...board, plan })} />
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-small" onClick={() => setBoard(BLANK)}>
            Start again
          </button>
        </div>
      </Panel>
    </Page>
  );
}
