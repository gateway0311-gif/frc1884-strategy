import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Chip, describeError, Empty, Link, Loading, Notice, Page, Panel } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { formatMetric, formatNumber } from "../lib/format";
import { useQuery } from "../lib/query";
import { useSession } from "../lib/session";
import { useCompiledTeams, type CompiledTeam } from "./Strategy";

type Tier = "first" | "second" | "third" | "avoid";

interface PickEntry {
  teamNumber: number;
  tier: Tier;
  note: string;
  picked: boolean;
}

interface PickList {
  revision: number;
  entries: PickEntry[];
}

const TIERS: Array<{ id: Tier; label: string; hint: string }> = [
  { id: "first", label: "First pick", hint: "Robots we would take first." },
  { id: "second", label: "Second pick", hint: "Strong partners if the first choices are gone." },
  { id: "third", label: "Third pick", hint: "Useful specialists and backups." },
  { id: "avoid", label: "Do not pick", hint: "Teams we have a reason to pass on." },
];

function strength(team: CompiledTeam): number {
  return team.estPoints ?? team.stats.epa ?? team.stats.opr ?? -1;
}

export function PicksPage() {
  const { event, game } = useSession();
  const compiled = useCompiledTeams();
  const server = useQuery<PickList>(event ? `picks:${event.eventKey}` : null, () => api(`/events/${event!.eventKey}/picks`), ["picks"]);
  const [list, setList] = useState<PickList | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hideTaken, setHideTaken] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const saving = useRef(false);

  // Take the server's list whenever it changes and we are not mid-save.
  useEffect(() => {
    if (server.data && !saving.current) setList(server.data);
  }, [server.data]);

  const teams = compiled.data?.teams ?? [];
  const ourTeam = compiled.data?.ourTeam ?? 1884;
  const byNumber = useMemo(() => new Map(teams.map((t) => [t.teamNumber, t])), [teams]);
  const columns = useMemo(() => game.metrics.filter((m) => [game.headlineMetric, "climb_points", "defence_rating"].includes(m.key)), [game]);

  if (!event) {
    return (
      <Page title="Pick list">
        <Empty title="No event is set up yet." />
      </Page>
    );
  }
  if (!list || compiled.loading) {
    return <Page title="Pick list">{server.error ? <Notice tone="error">{describeError(server.error)}</Notice> : <Loading />}</Page>;
  }

  async function save(entries: PickEntry[]) {
    const previous = list!;
    setList({ ...previous, entries });
    setNotice(null);
    saving.current = true;
    try {
      const result = await api<PickList>(`/events/${event!.eventKey}/picks`, { method: "PUT", body: { revision: previous.revision, entries: entries.map(({ teamNumber, tier, note }) => ({ teamNumber, tier, note })) } });
      setList(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setList(caught.details as PickList);
        setNotice("Someone else changed the list at the same moment, so your change was not applied. The list below is the current one.");
      } else {
        setList(previous);
        setNotice(describeError(caught));
      }
    } finally {
      saving.current = false;
    }
  }

  async function patch(teamNumber: number, body: { picked?: boolean; note?: string }) {
    setList({ ...list!, entries: list!.entries.map((e) => (e.teamNumber === teamNumber ? { ...e, ...body } : e)) });
    try {
      setList(await api<PickList>(`/events/${event!.eventKey}/picks/${teamNumber}`, { method: "PUT", body }));
    } catch (caught) {
      setNotice(describeError(caught));
      server.refresh();
    }
  }

  const entries = list.entries;
  const listed = new Set(entries.map((e) => e.teamNumber));
  const unlisted = teams.filter((t) => !listed.has(t.teamNumber) && t.teamNumber !== ourTeam).sort((a, b) => strength(b) - strength(a));

  function place(teamNumber: number, tier: Tier, before?: number) {
    const moving = entries.find((e) => e.teamNumber === teamNumber) ?? { teamNumber, tier, note: "", picked: false };
    const rest = entries.filter((e) => e.teamNumber !== teamNumber);
    const updated = { ...moving, tier };
    const index = before !== undefined ? rest.findIndex((e) => e.teamNumber === before) : -1;
    if (index >= 0) rest.splice(index, 0, updated);
    else {
      // Put it at the end of its tier.
      const lastOfTier = rest.map((e) => e.tier).lastIndexOf(tier);
      const tierIndex = TIERS.findIndex((t) => t.id === tier);
      const insertAt = lastOfTier >= 0 ? lastOfTier + 1 : rest.findIndex((e) => TIERS.findIndex((t) => t.id === e.tier) > tierIndex);
      rest.splice(insertAt === -1 ? rest.length : insertAt, 0, updated);
    }
    void save(rest);
  }

  function nudge(teamNumber: number, direction: -1 | 1) {
    const entry = entries.find((e) => e.teamNumber === teamNumber)!;
    const tierEntries = entries.filter((e) => e.tier === entry.tier);
    const at = tierEntries.findIndex((e) => e.teamNumber === teamNumber);
    const swap = tierEntries[at + direction];
    if (!swap) {
      // Off the end of a tier: move into the neighbouring one.
      const next = TIERS[TIERS.findIndex((t) => t.id === entry.tier) + direction];
      if (!next) return;
      const neighbours = entries.filter((e) => e.tier === next.id);
      place(teamNumber, next.id, direction === 1 ? neighbours[0]?.teamNumber : undefined);
      return;
    }
    const reordered = entries.map((e) => (e.teamNumber === teamNumber ? swap : e.teamNumber === swap.teamNumber ? entry : e));
    void save(reordered);
  }

  function fillFromScouting() {
    const ranked = [...unlisted].filter((t) => strength(t) >= 0);
    const size = Math.max(4, Math.ceil(ranked.length / 3));
    const filled: PickEntry[] = ranked.map((team, i) => ({ teamNumber: team.teamNumber, tier: i < size ? "first" : i < size * 2 ? "second" : "third", note: "", picked: false }));
    void save([...entries, ...filled]);
  }

  let overall = 0;
  const taken = entries.filter((e) => e.picked).length;

  return (
    <Page
      title="Pick list"
      lead="One shared list for alliance selection. Changes show for every strategist straight away."
      wide
      actions={
        <button type="button" className={`pill${hideTaken ? " is-on" : ""}`} aria-pressed={hideTaken} onClick={() => setHideTaken((v) => !v)}>
          Hide taken teams{taken ? ` (${taken})` : ""}
        </button>
      }
    >
      {notice ? <Notice tone="warn">{notice}</Notice> : null}
      {entries.length === 0 ? (
        <Empty title="The list is empty.">
          Start from the scouted figures, then move teams around.{" "}
          <button type="button" className="link-btn" onClick={fillFromScouting} disabled={unlisted.length === 0}>
            Fill the list from scouting
          </button>
        </Empty>
      ) : null}

      {TIERS.map((tier) => {
        const rows = entries.filter((e) => e.tier === tier.id);
        return (
          <Panel key={tier.id} title={tier.label} aside={`${rows.length} team${rows.length === 1 ? "" : "s"}`} tone={tier.id === "avoid" ? undefined : "gold"}>
            <ul
              className="picks"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging.current !== null) place(dragging.current, tier.id);
                dragging.current = null;
              }}
            >
              {rows.length === 0 ? <li className="picks-empty">{tier.hint} Drag a team here, or use the menu on a team.</li> : null}
              {rows.map((entry) => {
                const team = byNumber.get(entry.teamNumber);
                const rank = tier.id === "avoid" ? null : ++overall;
                if (hideTaken && entry.picked) return null;
                return (
                  <li
                    key={entry.teamNumber}
                    className={`pick${entry.picked ? " is-taken" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      dragging.current = entry.teamNumber;
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragging.current !== null && dragging.current !== entry.teamNumber) place(dragging.current, tier.id, entry.teamNumber);
                      dragging.current = null;
                    }}
                  >
                    <span className="pick-handle" aria-hidden="true">
                      <Icon name="drag" size={18} />
                    </span>
                    <span className="pick-rank">{rank ?? ""}</span>
                    <span className="pick-team">
                      <Link to={`/strategy/teams/${entry.teamNumber}`} className="team-link">
                        <strong>{entry.teamNumber}</strong> {team?.name}
                      </Link>
                      {editing === entry.teamNumber ? (
                        <input
                          className="pick-note-input"
                          autoFocus
                          defaultValue={entry.note}
                          maxLength={300}
                          placeholder="Why this team is here"
                          onBlur={(e) => {
                            setEditing(null);
                            if (e.target.value !== entry.note) void patch(entry.teamNumber, { note: e.target.value });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      ) : (
                        <button type="button" className="pick-note" onClick={() => setEditing(entry.teamNumber)}>
                          {entry.note || "Add a note"}
                        </button>
                      )}
                    </span>
                    <span className="pick-figures">
                      <span>
                        <small>Points</small>
                        {formatNumber(team?.estPoints ?? null)}
                      </span>
                      {columns.map((metric) => (
                        <span key={metric.key}>
                          <small>{metric.short}</small>
                          {formatMetric(metric, team?.metrics[metric.key]?.value)}
                        </span>
                      ))}
                      <span>
                        <small>Rank</small>
                        {team?.stats.rank ?? "–"}
                      </span>
                      {team?.flags.length ? <Chip tone="warn">Check figures</Chip> : null}
                    </span>
                    <span className="pick-actions">
                      <button type="button" className="icon-btn" aria-label={`Move ${entry.teamNumber} up`} onClick={() => nudge(entry.teamNumber, -1)}>
                        ↑
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Move ${entry.teamNumber} down`} onClick={() => nudge(entry.teamNumber, 1)}>
                        ↓
                      </button>
                      <select value={entry.tier} aria-label={`List for ${entry.teamNumber}`} onChange={(e) => (e.target.value === "remove" ? void save(entries.filter((x) => x.teamNumber !== entry.teamNumber)) : place(entry.teamNumber, e.target.value as Tier))}>
                        {TIERS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                        <option value="remove">Take off the list</option>
                      </select>
                      <button type="button" className={`pill pick-taken${entry.picked ? " is-on" : ""}`} aria-pressed={entry.picked} onClick={() => void patch(entry.teamNumber, { picked: !entry.picked })}>
                        {entry.picked ? "Taken" : "Mark taken"}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}

      {unlisted.length > 0 ? (
        <Panel
          title="Not on the list"
          aside={
            entries.length > 0 ? (
              <button type="button" className="link-btn" onClick={fillFromScouting}>
                Add them all by scouted strength
              </button>
            ) : undefined
          }
        >
          <ul className="picks">
            {unlisted.map((team) => (
              <li key={team.teamNumber} className="pick" draggable onDragStart={() => (dragging.current = team.teamNumber)}>
                <span className="pick-handle" aria-hidden="true">
                  <Icon name="drag" size={18} />
                </span>
                <span className="pick-rank" />
                <span className="pick-team">
                  <Link to={`/strategy/teams/${team.teamNumber}`} className="team-link">
                    <strong>{team.teamNumber}</strong> {team.name}
                  </Link>
                  <span className="cell-sub">{team.matchesObserved ? `${team.matchesObserved} matches watched` : "Not watched yet"}</span>
                </span>
                <span className="pick-figures">
                  <span>
                    <small>Points</small>
                    {formatNumber(team.estPoints)}
                  </span>
                  <span>
                    <small>EPA</small>
                    {formatNumber(team.stats.epa)}
                  </span>
                  <span>
                    <small>Rank</small>
                    {team.stats.rank ?? "–"}
                  </span>
                </span>
                <span className="pick-actions">
                  <select value="" aria-label={`Add ${team.teamNumber} to a list`} onChange={(e) => e.target.value && place(team.teamNumber, e.target.value as Tier)}>
                    <option value="">Add to…</option>
                    {TIERS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </Page>
  );
}
