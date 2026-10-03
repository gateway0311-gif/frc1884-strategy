import { useEffect, useMemo, useState } from "react";
import type { EntryData, EntryValue } from "@shared/games/index";
import { EntryForm } from "../components/fields";
import { Chip, describeError, Empty, Link, Loading, Notice, Page } from "../components/ui";
import { api } from "../lib/api";
import { useLiveState } from "../lib/live";
import { findLocalPit, flush, getLocal, newEntryId, putLocal, scheduleFlush, useOutbox } from "../lib/outbox";
import { useQuery } from "../lib/query";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";

export interface PitTeam {
  teamNumber: number;
  name: string;
  done: number;
  scouts: string[];
  mine: { id: string; status: "draft" | "submitted" } | null;
  entries?: Array<{ id: string; scout: string; status: string; data: EntryData; updatedAt: string; submittedAt: string | null }>;
}

export function usePitTeams() {
  const { event } = useSession();
  return useQuery<{ teams: PitTeam[] }>(event ? `pit:${event.eventKey}` : null, () => api(`/events/${event!.eventKey}/pit`), ["pit", "teams"], { persist: true });
}

export function PitList() {
  const pit = usePitTeams();
  const [search, setSearch] = useState("");
  const [todo, setTodo] = useState(true);
  const teams = pit.data?.teams ?? [];
  const visited = teams.filter((t) => t.done > 0).length;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return teams.filter((team) => {
      if (needle && !String(team.teamNumber).includes(needle) && !team.name.toLowerCase().includes(needle)) return false;
      if (todo && !needle && team.done > 0 && team.mine?.status !== "draft") return false;
      return true;
    });
  }, [teams, search, todo]);

  return (
    <Page title="Pit scouting" lead={teams.length ? `${visited} of ${teams.length} teams visited so far.` : undefined} back="/scout">
      <div className="row">
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Find a team by number or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className={`pill${todo ? " is-on" : ""}`} aria-pressed={todo} onClick={() => setTodo((v) => !v)}>
          Not visited yet
        </button>
      </div>
      {pit.loading ? <Loading /> : null}
      {pit.error ? <Notice tone="error">{describeError(pit.error)}</Notice> : null}
      {!pit.loading && teams.length === 0 ? <Empty title="No teams yet.">Teams appear here once the event is set up.</Empty> : null}
      {!pit.loading && teams.length > 0 && shown.length === 0 ? <Empty title={todo && !search ? "Every team has been visited." : "No team matches."} /> : null}
      {shown.length > 0 ? (
        <div className="link-list">
          {shown.map((team) => (
            <Link key={team.teamNumber} to={`/scout/pit/${team.teamNumber}`} className="link-row">
              <span>
                <strong>{team.teamNumber}</strong> {team.name}
                {team.scouts.length ? <span className="cell-sub">Visited by {team.scouts.join(", ")}</span> : null}
              </span>
              {team.mine?.status === "draft" ? <Chip tone="warn">Finish</Chip> : team.mine ? <Chip tone="good">Yours, sent</Chip> : team.done ? <Chip tone="dim">Visited</Chip> : <Chip tone="gold">To do</Chip>}
            </Link>
          ))}
        </div>
      ) : null}
    </Page>
  );
}

export function PitEntry({ teamNumber }: { teamNumber: number }) {
  const { event, game } = useSession();
  const pit = usePitTeams();
  const outbox = useOutbox();
  const live = useLiveState();
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const team = pit.data?.teams.find((t) => t.teamNumber === teamNumber);

  // Find this scout's entry for the team: on this phone, on the server, or start one.
  useEffect(() => {
    if (!event || id || !pit.data) return;
    const local = findLocalPit(event.eventKey, teamNumber);
    if (local) return setId(local.id);
    if (!team) return setError("This team is not at this event.");
    const base = { kind: "pit" as const, eventKey: event.eventKey, matchKey: "", label: "Pit", teamNumber, teamName: team.name, alliance: null };
    if (team.mine) {
      const mineId = team.mine.id;
      api<{ entry: { id: string; data: EntryData; status: "draft" | "submitted" } }>(`/events/${event.eventKey}/pit/${mineId}`)
        .then(({ entry }) => {
          if (!getLocal(entry.id)) putLocal({ ...base, id: entry.id, data: entry.data, status: entry.status, dirty: false, updatedAt: Date.now() });
          setId(entry.id);
        })
        .catch((caught) => setError(describeError(caught)));
      return;
    }
    const fresh = newEntryId();
    putLocal({ ...base, id: fresh, data: {}, status: "draft", dirty: false, updatedAt: Date.now() });
    setId(fresh);
  }, [event, id, pit.data, team, teamNumber]);

  const entry = id ? outbox.entries[id] : undefined;
  if (!entry) {
    return (
      <Page title={`Team ${teamNumber}`} back="/scout/pit">
        {error ? <Notice tone="error">{error}</Notice> : <Loading />}
      </Page>
    );
  }

  function change(key: string, value: EntryValue) {
    const current = getLocal(entry!.id);
    if (!current) return;
    putLocal({ ...current, data: { ...current.data, [key]: value }, dirty: true, updatedAt: Date.now(), problems: undefined });
    scheduleFlush();
  }

  function submit() {
    const current = getLocal(entry!.id);
    if (!current) return;
    putLocal({ ...current, status: "submitted", dirty: true, updatedAt: Date.now(), problems: undefined });
    void flush();
    navigate("/scout/pit");
  }

  const saveState = entry.dirty ? (live === "offline" ? "Saved on this phone. It sends when the signal returns." : "Saving…") : entry.status === "submitted" ? "Submitted" : "Saved";

  return (
    <main className="page entry-page">
      <header className="entry-head entry-head-none">
        <Link to="/scout/pit" className="back-link">
          Back
        </Link>
        <div className="entry-head-main">
          <span className="entry-team">{teamNumber}</span>
          <span className="entry-meta">
            <strong>{team?.name ?? entry.teamName ?? "Team"}</strong>
            <span>Pit visit{team && team.scouts.length ? `. Already visited by ${team.scouts.join(", ")}` : ""}</span>
          </span>
        </div>
        <div className="entry-save" role="status">
          {saveState}
        </div>
      </header>
      {entry.problems?.length ? (
        <Notice tone="error">
          This entry was not accepted:
          <ul>
            {entry.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <p className="muted">Fill in what you can. Leave anything the team could not answer.</p>
      <EntryForm sections={game.pitForm} data={entry.data} onChange={change} />
      <div className="entry-submit">
        <button type="button" className="btn btn-primary btn-block" onClick={submit}>
          {entry.status === "submitted" ? "Submit changes" : "Submit pit visit"}
        </button>
      </div>
    </main>
  );
}
