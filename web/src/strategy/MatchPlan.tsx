import { useEffect, useRef, useState } from "react";
import type { ScheduleMatch } from "@shared/schedule";
import { Notice, Panel } from "../components/ui";
import { getField } from "../games";
import { api } from "../lib/api";
import { onLiveChange } from "../lib/live";
import { useSession } from "../lib/session";
import { EMPTY_PHASE, FieldPlanner, type PhasePlan } from "./FieldPlanner";

type Phase = "auto" | "teleop";
type Phases = Record<Phase, PhasePlan>;

interface PlanResponse {
  plan: { phases: Partial<Record<Phase, Partial<PhasePlan>>>; updatedAt: string } | null;
}

function normalise(input: Partial<PhasePlan> | undefined): PhasePlan {
  return { pos: input?.pos ?? {}, strokes: input?.strokes ?? [], notes: typeof input?.notes === "string" ? input.notes : "" };
}

const clientId = Math.random().toString(36).slice(2);

// The plan for one match: where each robot goes in auto and in teleop, with
// sketches and notes. Saved as you go and shared live with everyone else
// looking at the same match.
export function MatchPlan({ match, ourTeam }: { match: ScheduleMatch; ourTeam: number }) {
  const { event, game } = useSession();
  const field = getField(game.id);
  const [phase, setPhase] = useState<Phase>("auto");
  const [phases, setPhases] = useState<Phases | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [other, setOther] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef<Phases | null>(null);
  const path = `/events/${event!.eventKey}/plans/${match.matchKey}`;

  async function load() {
    const { plan } = await api<PlanResponse>(path);
    const next = { auto: normalise(plan?.phases.auto), teleop: normalise(plan?.phases.teleop) };
    latest.current = next;
    setPhases(next);
  }

  useEffect(() => {
    setPhases(null);
    dirty.current = false;
    void load().catch(() => setState("error"));
    // Someone else changed this plan: take their version unless we are mid-edit.
    const stop = onLiveChange((change) => {
      if (change.entity !== "plan" || change.key !== match.matchKey) return;
      const payload = change.payload as { clientId?: string; by?: string } | null;
      if (payload?.clientId === clientId) return;
      setOther(payload?.by ?? "Someone");
      if (!dirty.current) void load().catch(() => undefined);
    });
    return () => {
      stop();
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current && latest.current) void api(path, { method: "PUT", body: { phases: latest.current, clientId } }).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  function change(next: PhasePlan) {
    if (!phases) return;
    const updated = { ...phases, [phase]: next };
    latest.current = updated;
    dirty.current = true;
    setPhases(updated);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api(path, { method: "PUT", body: { phases: latest.current, clientId } });
        dirty.current = false;
        setState("saved");
      } catch {
        setState("error");
      }
    }, 700);
  }

  const planMatch = { red: match.red.map((t) => t.teamNumber), blue: match.blue.map((t) => t.teamNumber) };

  return (
    <Panel
      title="Plan"
      aside={
        <span role="status">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved. Check your connection." : ""}
          {other ? ` ${other} is also working on this plan.` : ""}
        </span>
      }
    >
      <div className="row row-between" style={{ marginBottom: 10 }}>
        <div className="row">
          <button type="button" className={`pill${phase === "auto" ? " is-on" : ""}`} aria-pressed={phase === "auto"} onClick={() => setPhase("auto")}>
            Auto
          </button>
          <button type="button" className={`pill${phase === "teleop" ? " is-on" : ""}`} aria-pressed={phase === "teleop"} onClick={() => setPhase("teleop")}>
            Teleop
          </button>
        </div>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.origin + `/hub/strategy/matches/${match.matchKey}`).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Link copied" : "Copy link to this plan"}
        </button>
      </div>
      {phases ? (
        <>
          <FieldPlanner field={field} match={planMatch} ourTeam={ourTeam} plan={phases[phase] ?? EMPTY_PHASE} onChange={change} />
          <label className="field" style={{ marginTop: 12 }}>
            <span>{phase === "auto" ? "Auto notes" : "Teleop notes"}</span>
            <textarea value={phases[phase].notes} onChange={(e) => change({ ...phases[phase], notes: e.target.value })} placeholder="What each robot does, who takes which lane, what to do if it goes wrong." />
          </label>
        </>
      ) : state === "error" ? (
        <Notice tone="error">The plan could not be loaded.</Notice>
      ) : (
        <p className="dim">Loading the plan…</p>
      )}
    </Panel>
  );
}
