import { useEffect, useMemo, useState } from "react";
import type { EntryData, EntryValue } from "@shared/games/index";
import { allFields } from "@shared/games/index";
import { teamsIn } from "@shared/schedule";
import { EntryForm, isMissing } from "../components/fields";
import { Chip, describeError, Empty, Link, Loading, Notice, Page, Panel } from "../components/ui";
import { api } from "../lib/api";
import { formatCountdown, formatTime, useMatchClock, useNow, useSchedule } from "../lib/data";
import { useLiveState } from "../lib/live";
import { findLocal, flush, getLocal, newEntryId, putLocal, scheduleFlush, useOutbox, type LocalEntry } from "../lib/outbox";
import { invalidate, useQuery } from "../lib/query";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";

interface MyAssignment {
  matchKey: string;
  label: string;
  alliance: "red" | "blue";
  station: number;
  teamNumber: number;
  teamName: string | null;
  startsAt: number | null;
  started: boolean;
  entry: { id: string; status: "draft" | "submitted" | "void"; updatedAt: string } | null;
}

interface MyEntry {
  id: string;
  matchKey: string;
  label: string;
  teamNumber: number;
  status: "draft" | "submitted" | "void";
  updatedAt: string;
  submittedAt: string | null;
}

interface MyResponse {
  serverTime: string;
  scout: { name: string; role: string; scouting: boolean; onBreak: boolean };
  nextMatch: { matchKey: string; label: string; startsAt: number | null } | null;
  assignments: MyAssignment[];
  entries: MyEntry[];
}

function useMy() {
  const { event } = useSession();
  return useQuery<MyResponse>(event ? `my:${event.eventKey}` : null, () => api(`/events/${event!.eventKey}/my`), ["assignment", "schedule", "my"], { persist: true });
}

function openEntry(eventKey: string, slot: { matchKey: string; label: string; teamNumber: number; teamName: string | null; alliance: "red" | "blue" | null; entryId?: string }) {
  const local = findLocal(eventKey, slot.matchKey, slot.teamNumber);
  if (local) return navigate(`/scout/entry/${local.id}`);
  if (slot.entryId) return navigate(`/scout/entry/${slot.entryId}`);
  const entry: LocalEntry = {
    id: newEntryId(),
    eventKey,
    matchKey: slot.matchKey,
    label: slot.label,
    teamNumber: slot.teamNumber,
    teamName: slot.teamName,
    alliance: slot.alliance,
    data: {},
    status: "draft",
    // Sent straight away so the scout manager sees the entry has been opened.
    dirty: true,
    updatedAt: Date.now(),
  };
  putLocal(entry);
  scheduleFlush(0);
  navigate(`/scout/entry/${entry.id}`);
}

function Placard({ slot, eventKey, now }: { slot: MyAssignment; eventKey: string; now: number }) {
  const local = findLocal(eventKey, slot.matchKey, slot.teamNumber);
  const status = local?.status ?? slot.entry?.status ?? null;
  const submitted = status === "submitted" && !local?.dirty;
  const when =
    slot.startsAt === null
      ? "Start time not known yet"
      : slot.started
        ? "Under way now"
        : `Starts in ${formatCountdown(slot.startsAt - now)}, at ${formatTime(slot.startsAt)}`;
  return (
    <section className={`placard placard-${slot.alliance}`}>
      <div className="placard-match">
        <strong>{slot.label}</strong>
        <span>{when}</span>
      </div>
      <div className="placard-team">{slot.teamNumber}</div>
      <div className="placard-name">
        {slot.teamName ?? "Team"} <span className="placard-station">{slot.alliance === "red" ? "Red" : "Blue"} {slot.station}</span>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block placard-go"
        onClick={() => openEntry(eventKey, { ...slot, entryId: slot.entry?.id })}
      >
        {submitted ? "Submitted. Open to change" : status ? "Continue this entry" : "Start scouting"}
      </button>
    </section>
  );
}

export function ScoutHome() {
  const { event, user } = useSession();
  const my = useMy();
  const now = useNow(1000);
  const outbox = useOutbox();
  const live = useLiveState();
  const [busy, setBusy] = useState(false);

  if (!event) {
    return (
      <Page title="Scout">
        <Empty title="No event is set up yet.">A lead sets up the event in Admin. This page fills in as soon as they do.</Empty>
      </Page>
    );
  }
  if (!my.data) {
    return <Page title="Scout">{my.error ? <Notice tone="error">{describeError(my.error)}</Notice> : <Loading />}</Page>;
  }

  const data = my.data;
  const [first, ...later] = data.assignments;
  const firstIsNext = first && data.nextMatch && first.matchKey === data.nextMatch.matchKey;

  async function update(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/me", { method: "PUT", body: { ...body, eventKey: event!.eventKey } });
      invalidate("my");
    } finally {
      setBusy(false);
    }
  }

  const localUnsent = Object.values(outbox.entries).filter((e) => e.eventKey === event.eventKey && (e.dirty || e.problems?.length));
  const drafts = data.entries.filter((e) => e.status === "draft");
  const done = data.entries.filter((e) => e.status === "submitted");

  return (
    <Page title={`Hello, ${user!.name.split(" ")[0]}`}>
      {live === "offline" ? <Notice tone="warn">No signal. You can keep scouting: entries are saved on this phone. Your robots below are the last ones we could fetch.</Notice> : null}
      {outbox.waiting > 0 ? (
        <Notice tone="warn">
          {outbox.waiting === 1 ? "1 entry is" : `${outbox.waiting} entries are`} saved on this phone and waiting to send.
          {live === "offline" ? " They go automatically when the signal returns." : ""}{" "}
          <button type="button" className="link-btn" onClick={() => void flush()}>
            Send now
          </button>
        </Notice>
      ) : null}

      {!data.scout.scouting ? (
        <Panel title="You are not on the scouting rota">
          <p className="muted">Scouts are given a robot to watch for each match. Join if you are scouting today.</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void update({ scouting: true })}>
            Join the rota
          </button>
        </Panel>
      ) : data.scout.onBreak ? (
        <Panel title="You are on a break" tone="gold">
          <p className="muted">You will not be given robots until you come back.</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={() => void update({ onBreak: false })}>
            I am back
          </button>
        </Panel>
      ) : first ? (
        <>
          {!firstIsNext && data.nextMatch ? <Notice>You are resting for {data.nextMatch.label}. Your next robot is below.</Notice> : null}
          <Placard slot={first} eventKey={event.eventKey} now={now} />
        </>
      ) : data.nextMatch ? (
        <Empty title={`You are resting for ${data.nextMatch.label}.`}>Every robot is covered. You will be given one for a later match.</Empty>
      ) : (
        <Empty title="No matches to scout right now.">Your robot appears here as soon as the next match is on the schedule.</Empty>
      )}

      {later.length > 0 && data.scout.scouting && !data.scout.onBreak ? (
        <Panel title="After that">
          <ul className="upcoming">
            {later.map((slot) => (
              <li key={slot.matchKey}>
                <span>
                  <strong>{slot.label}</strong>
                  <span className="cell-sub">{slot.startsAt ? formatTime(slot.startsAt) : "Time not known"}</span>
                </span>
                <span className={`upcoming-team upcoming-${slot.alliance}`}>
                  {slot.teamNumber}
                  <span className="cell-sub">{slot.teamName}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="panel-note">These can change if scouts come and go before the match starts.</p>
        </Panel>
      ) : null}

      {localUnsent.some((e) => e.problems?.length) ? (
        <Panel title="Needs your attention">
          {localUnsent
            .filter((e) => e.problems?.length)
            .map((entry) => (
              <Link key={entry.id} to={`/scout/entry/${entry.id}`} className="entry-row">
                <span>
                  <strong>
                    {entry.label}, team {entry.teamNumber}
                  </strong>
                  <span className="cell-sub">{entry.problems![0]}</span>
                </span>
                <Chip tone="warn">Fix</Chip>
              </Link>
            ))}
        </Panel>
      ) : null}

      {drafts.length > 0 ? (
        <Panel title="Not submitted yet">
          {drafts.map((entry) => (
            <Link key={entry.id} to={`/scout/entry/${entry.id}`} className="entry-row">
              <span>
                <strong>
                  {entry.label}, team {entry.teamNumber}
                </strong>
              </span>
              <Chip tone="warn">Finish</Chip>
            </Link>
          ))}
        </Panel>
      ) : null}

      {data.scout.scouting ? (
        <div className="row">
          <Link to="/scout/pick" className="btn">
            Scout a different robot
          </Link>
          <Link to="/scout/pit" className="btn">
            Pit scouting
          </Link>
          {!data.scout.onBreak ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void update({ onBreak: true })}>
              Take a break
            </button>
          ) : null}
          {user!.role !== "scout" ? (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void update({ scouting: false })}>
              Leave the rota
            </button>
          ) : null}
        </div>
      ) : null}

      {done.length > 0 ? (
        <Panel title="Submitted" aside={`${done.length}`}>
          {done.map((entry) => (
            <Link key={entry.id} to={`/scout/entry/${entry.id}`} className="entry-row">
              <span>
                <strong>
                  {entry.label}, team {entry.teamNumber}
                </strong>
              </span>
              <Chip tone="good">Sent</Chip>
            </Link>
          ))}
        </Panel>
      ) : null}
    </Page>
  );
}

export function ScoutPick() {
  const { event } = useSession();
  const schedule = useSchedule();
  const now = useNow();
  const clock = useMatchClock(schedule.data?.matches, now);
  const [matchKey, setMatchKey] = useState<string | null>(null);

  const options = useMemo(() => {
    const matches = schedule.data?.matches ?? [];
    if (!clock) return matches;
    const firstUpcoming = matches.findIndex((m) => !clock.done[m.matchKey]);
    const from = Math.max(0, (firstUpcoming === -1 ? matches.length : firstUpcoming) - 6);
    return matches.slice(from, from + 14);
  }, [schedule.data, clock]);

  const selected = options.find((m) => m.matchKey === matchKey) ?? null;

  return (
    <Page title="Scout a different robot" lead="For catching up on a match you watched, or covering for someone." back="/scout">
      {schedule.loading ? <Loading /> : null}
      {options.length === 0 && !schedule.loading ? <Empty title="No matches on the schedule yet." /> : null}
      <div className="segments">
        {options.map((match) => (
          <button key={match.matchKey} type="button" className={`segment${match.matchKey === matchKey ? " is-on" : ""}`} onClick={() => setMatchKey(match.matchKey)}>
            {match.label}
          </button>
        ))}
      </div>
      {selected && event ? (
        <Panel title={`${selected.label}: which robot?`}>
          <div className="robot-grid">
            {teamsIn(selected).map((team) => (
              <button
                key={team.teamNumber}
                type="button"
                className={`robot robot-${team.alliance}`}
                onClick={() => openEntry(event.eventKey, { matchKey: selected.matchKey, label: selected.label, teamNumber: team.teamNumber, teamName: team.name, alliance: team.alliance })}
              >
                <strong>{team.teamNumber}</strong>
                <span>{team.name}</span>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}

interface ServerEntry {
  id: string;
  eventKey: string;
  matchKey: string;
  teamNumber: number;
  data: EntryData;
  status: "draft" | "submitted" | "void";
}

export function ScoutEntry({ id }: { id: string }) {
  const { event, game } = useSession();
  const outbox = useOutbox();
  const schedule = useSchedule();
  const live = useLiveState();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const entry = outbox.entries[id];

  // Opened on a device that does not have this entry yet: fetch it once.
  useEffect(() => {
    if (entry || !event) return;
    let cancelled = false;
    api<{ entry: ServerEntry }>(`/events/${event.eventKey}/entries/${id}`)
      .then(({ entry: remote }) => {
        if (cancelled || getLocal(id)) return;
        putLocal({
          id: remote.id,
          eventKey: remote.eventKey,
          matchKey: remote.matchKey,
          label: remote.matchKey,
          teamNumber: remote.teamNumber,
          teamName: null,
          alliance: null,
          data: remote.data,
          status: remote.status === "submitted" ? "submitted" : "draft",
          dirty: false,
          updatedAt: Date.now(),
        });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(describeError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [entry, event, id]);

  const match = schedule.data?.matches.find((m) => m.matchKey === entry?.matchKey);
  const team = match ? teamsIn(match).find((t) => t.teamNumber === entry?.teamNumber) : undefined;
  const alliance = entry?.alliance ?? team?.alliance ?? null;
  const label = match?.label ?? entry?.label ?? "";

  if (!entry) {
    return (
      <Page title="Entry" back="/scout">
        {loadError ? <Notice tone="error">{loadError}</Notice> : <Loading />}
      </Page>
    );
  }

  const fields = allFields(game.matchForm);
  const missing = fields.filter((field) => isMissing(field, entry.data[field.key]));

  function change(key: string, value: EntryValue) {
    const current = getLocal(id);
    if (!current) return;
    putLocal({ ...current, data: { ...current.data, [key]: value }, dirty: true, updatedAt: Date.now(), problems: undefined });
    scheduleFlush();
  }

  function submit() {
    if (missing.length > 0) {
      setShowMissing(true);
      document.getElementById(`section-${game.matchForm.find((s) => s.fields.some((f) => f.key === missing[0].key))?.id}`)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const current = getLocal(id);
    if (!current) return;
    putLocal({ ...current, status: "submitted", dirty: true, updatedAt: Date.now(), problems: undefined });
    void flush();
    navigate("/scout");
  }

  const saveState = entry.dirty
    ? live === "offline"
      ? "Saved on this phone. It sends when the signal returns."
      : "Saving…"
    : entry.status === "submitted"
      ? "Submitted"
      : "Saved";

  return (
    <main className="page entry-page">
      <header className={`entry-head entry-head-${alliance ?? "none"}`}>
        <Link to="/scout" className="back-link">
          Back
        </Link>
        <div className="entry-head-main">
          <span className="entry-team">{entry.teamNumber}</span>
          <span className="entry-meta">
            <strong>{team?.name ?? entry.teamName ?? "Team"}</strong>
            <span>
              {label}
              {alliance ? `, ${alliance === "red" ? "red" : "blue"} alliance` : ""}
            </span>
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

      <EntryForm sections={game.matchForm} data={entry.data} onChange={change} showMissing={showMissing} />

      <div className="entry-submit">
        {showMissing && missing.length > 0 ? (
          <Notice tone="warn">
            Still needed: {missing.map((f) => f.label).join(", ")}.
          </Notice>
        ) : null}
        <button type="button" className="btn btn-primary btn-block" onClick={submit}>
          {entry.status === "submitted" ? "Submit changes" : "Submit entry"}
        </button>
      </div>
    </main>
  );
}
