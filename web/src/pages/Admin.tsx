import { useState, type FormEvent } from "react";
import { ROLE_LABELS, ROLES, type Role } from "@shared/roles";
import { Chip, describeError, Loading, Notice, Page, Panel } from "../components/ui";
import { api } from "../lib/api";
import { formatAgo, useNow } from "../lib/data";
import { useQuery } from "../lib/query";
import { useSession } from "../lib/session";

interface SyncStep {
  step: string;
  ok: boolean;
  detail: string;
}

interface AdminEvent {
  eventKey: string;
  name: string;
  season: number;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  gameId: string | null;
  teamCount: number;
  matchCount: number;
  lastSync: { at: string; steps: SyncStep[] } | null;
  ourRobot: string;
}

interface Overview {
  activeEventKey: string | null;
  events: AdminEvent[];
  games: Array<{ id: string; name: string; season: number }>;
  ourTeam: number;
  autoSync: boolean;
  server: { tba: boolean; ai: boolean; codes: Role[]; sessionSecret: boolean };
}

function Status({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={ok ? "status status-ok" : "status status-missing"}>
      <span aria-hidden="true">{ok ? "✓" : "!"}</span>
      {children}
    </li>
  );
}

function SyncSteps({ steps }: { steps: SyncStep[] }) {
  return (
    <ul className="steps">
      {steps.map((step) => (
        <li key={step.step} className={step.ok ? "step-ok" : "step-failed"}>
          <strong>{step.step}</strong>
          <span>{step.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function AdminPage() {
  const { reload } = useSession();
  const overview = useQuery<Overview>("admin:overview", () => api("/admin/overview"), ["schedule", "session"]);
  const now = useNow();
  const [eventKey, setEventKey] = useState("");
  const [gameId, setGameId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamDraft, setTeamDraft] = useState<string | null>(null);
  const [robotDraft, setRobotDraft] = useState<Record<string, string>>({});

  const data = overview.data;

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      overview.refresh();
      await reload();
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      setError(
        code === "invalid_event_key"
          ? "That does not look like an event key. It is the year followed by a short code, such as 2026new."
          : describeError(caught)
      );
    } finally {
      setBusy(null);
    }
  }

  function setUp(event: FormEvent) {
    event.preventDefault();
    void run("setup", () => api("/admin/events", { method: "POST", body: { eventKey, gameId: gameId || data?.games[0]?.id } }).then(() => setEventKey("")));
  }

  if (overview.loading || !data) {
    return (
      <Page title="Admin">
        {overview.error ? <Notice tone="error">{describeError(overview.error)}</Notice> : <Loading />}
      </Page>
    );
  }

  return (
    <Page title="Admin" lead="Set up the event the team is working on and keep its public data up to date.">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Panel title="Set up an event">
        <form className="form-grid" onSubmit={setUp}>
          <label className="field">
            <span>Event key</span>
            <input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="2026new" autoCapitalize="none" required />
            <span className="field-help">The last part of the event's address on The Blue Alliance.</span>
          </label>
          <label className="field">
            <span>Game</span>
            <select value={gameId || data.games[0]?.id} onChange={(e) => setGameId(e.target.value)}>
              {data.games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name} {game.season}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              {busy === "setup" ? "Setting up…" : "Set up and import"}
            </button>
          </div>
        </form>
      </Panel>

      {data.events.map((event) => {
        const active = event.eventKey === data.activeEventKey;
        return (
          <Panel
            key={event.eventKey}
            tone={active ? "gold" : undefined}
            title={
              <>
                {event.name} {active ? <Chip tone="gold">Active</Chip> : null}
              </>
            }
            aside={event.eventKey}
          >
            <p className="muted">
              {[event.location, event.startDate && event.endDate ? `${event.startDate} to ${event.endDate}` : null].filter(Boolean).join(". ")}
            </p>
            <p className="dim">
              {event.teamCount} teams, {event.matchCount} matches. Last import {formatAgo(event.lastSync?.at, now)}.
            </p>
            {event.lastSync ? <SyncSteps steps={event.lastSync.steps} /> : null}
            {active ? (
              <label className="field" style={{ marginTop: 12 }}>
                <span>What our robot does at this event</span>
                <textarea
                  value={robotDraft[event.eventKey] ?? event.ourRobot}
                  placeholder="For example: fast defender that ferries fuel when our hub is active. Does not shoot or climb."
                  onChange={(e) => setRobotDraft({ ...robotDraft, [event.eventKey]: e.target.value })}
                  onBlur={() => {
                    const draft = robotDraft[event.eventKey];
                    if (draft !== undefined && draft !== event.ourRobot) {
                      void run("robot", () => api(`/admin/events/${event.eventKey}`, { method: "PUT", body: { ourRobot: draft } }));
                    }
                  }}
                />
                <span className="field-help">The AI briefs build their advice on this. Saved when you leave the box.</span>
              </label>
            ) : null}
            <div className="row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy !== null}
                onClick={() => void run(`sync:${event.eventKey}`, () => api(`/admin/events/${event.eventKey}/sync`, { method: "POST", body: {} }))}
              >
                {busy === `sync:${event.eventKey}` ? "Importing…" : "Import now"}
              </button>
              {!active ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => void run("active", () => api("/admin/active-event", { method: "PUT", body: { eventKey: event.eventKey } }))}
                >
                  Make active
                </button>
              ) : null}
              <label className="inline-field">
                <span>Game</span>
                <select
                  value={event.gameId ?? data.games[0]?.id}
                  onChange={(e) => void run("game", () => api(`/admin/events/${event.eventKey}`, { method: "PUT", body: { gameId: e.target.value } }))}
                >
                  {data.games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name} {game.season}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Panel>
        );
      })}

      <Panel title="Settings">
        <div className="form-grid">
          <label className="field">
            <span>Our team number</span>
            <input
              inputMode="numeric"
              value={teamDraft ?? String(data.ourTeam)}
              onChange={(e) => setTeamDraft(e.target.value)}
              onBlur={() => {
                if (teamDraft !== null && Number(teamDraft) !== data.ourTeam) {
                  void run("team", () => api("/admin/settings", { method: "PUT", body: { ourTeam: Number(teamDraft) } }));
                }
                setTeamDraft(null);
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={data.autoSync}
              onChange={(e) => void run("auto", () => api("/admin/settings", { method: "PUT", body: { autoSync: e.target.checked } }))}
            />
            <span>
              Import automatically during the event
              <span className="cell-sub">Every two minutes while the active event is on.</span>
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Server">
        <ul className="status-list">
          <Status ok={data.server.tba}>{data.server.tba ? "The Blue Alliance key is set" : "The Blue Alliance key is missing: schedules cannot be imported"}</Status>
          <Status ok={data.server.ai}>{data.server.ai ? "AI key is set" : "AI key is missing: briefs cannot be written"}</Status>
          {ROLES.map((role) => (
            <Status key={role} ok={data.server.codes.includes(role)}>
              {data.server.codes.includes(role) ? `${ROLE_LABELS[role]} code is set` : `${ROLE_LABELS[role]} code is missing: nobody can sign in with this role`}
            </Status>
          ))}
          <Status ok={data.server.sessionSecret}>
            {data.server.sessionSecret ? "Session secret is set" : "Session secret is missing: everyone is signed out whenever the server restarts"}
          </Status>
        </ul>
        <p className="panel-note">These are set on the server by whoever runs it, not from this page.</p>
      </Panel>
    </Page>
  );
}
