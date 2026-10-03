import { useMemo, useState } from "react";
import { allFields, type EntryData, type GameDefinition, type RpResult } from "@shared/games/index";
import type { ScheduleMatch } from "@shared/schedule";
import { BarChart } from "../components/BarChart";
import { Brief } from "../components/Brief";
import { formatValue } from "../components/fields";
import { Chip, describeError, Empty, Link, Loading, Notice, Page, Panel } from "../components/ui";
import { api } from "../lib/api";
import { formatCountdown, formatTime, useMatchClock, useNow, useSchedule } from "../lib/data";
import { formatMetric, formatNumber } from "../lib/format";
import { useQuery } from "../lib/query";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";

export interface CompiledMetric {
  value: number | null;
  best: number | null;
  worst: number | null;
  last3: number | null;
  trend: number | null;
  spread: number | null;
  matches: number;
  disagreements: number;
}

export interface CompiledTeam {
  teamNumber: number;
  name: string;
  location: string | null;
  matchesObserved: number;
  entryCount: number;
  metrics: Record<string, CompiledMetric>;
  estPoints: number | null;
  flags: Array<{ kind: string; text: string }>;
  pit: EntryData | null;
  pitScouts: string[];
  stats: { rank: number | null; rankingScore: number | null; wins: number | null; losses: number | null; ties: number | null; played: number | null; opr: number | null; dpr: number | null; epa: number | null };
  problems: Record<string, number>;
}

interface TeamsResponse {
  teams: CompiledTeam[];
  ourTeam: number;
  coverage: { entries: number; matchesWithEntries: number; teamsObserved: number; teamsPitScouted: number; teamCount: number };
}

const TAGS = ["compiled", "stats", "schedule", "pit"];

const TABS = [
  { id: "overview", label: "Overview", to: "/strategy" },
  { id: "teams", label: "Teams", to: "/strategy/teams" },
  { id: "matches", label: "Matches", to: "/strategy/matches" },
];

function Tabs({ active }: { active: string }) {
  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <Link key={tab.id} to={tab.to} className={`tab${tab.id === active ? " is-active" : ""}`}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function useCompiledTeams() {
  const { event } = useSession();
  return useQuery<TeamsResponse>(event ? `analysis:teams:${event.eventKey}` : null, () => api(`/events/${event!.eventKey}/analysis/teams`), TAGS);
}

function TeamLink({ number, name, ours }: { number: number; name?: string; ours?: boolean }) {
  return (
    <Link to={`/strategy/teams/${number}`} className={ours ? "team-link team-ours" : "team-link"}>
      <strong>{number}</strong>
      {name ? ` ${name}` : ""}
    </Link>
  );
}

function record(stats: CompiledTeam["stats"]): string {
  if (stats.wins === null) return "";
  return `${stats.wins}–${stats.losses}${stats.ties ? `–${stats.ties}` : ""}`;
}

/* Overview */

interface DashboardData {
  ourTeam: number;
  us: { rank: number | null; wins: number | null; losses: number | null; ties: number | null; rankingScore: number | null; teamCount: number };
  nextMatches: Array<{ matchKey: string; label: string; startsAt: number | null; alliance: "red" | "blue"; partners: number[]; opponents: number[]; favourite: "red" | "blue" | "even" | null }>;
  topTeams: Array<{ teamNumber: number; name: string; points: number; matchesObserved: number }>;
  movers: Array<{ teamNumber: number; name: string; change: number; direction: "up" | "down" }>;
  watchList: Array<{ teamNumber: number; name: string; flags: string[] }>;
  coverage: { entries: number; matchesWithEntries: number; teamsObserved: number; teamsPitScouted: number; teamCount: number; matchesPlayed: number };
}

function Overview() {
  const { event, game } = useSession();
  const now = useNow();
  const dash = useQuery<DashboardData>(event ? `analysis:dashboard:${event.eventKey}` : null, () => api(`/events/${event!.eventKey}/analysis/dashboard`), TAGS);
  if (dash.loading || !dash.data) return dash.error ? <Notice tone="error">{describeError(dash.error)}</Notice> : <Loading />;
  const data = dash.data;
  const headline = game.metrics.find((m) => m.key === game.headlineMetric);

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <strong>
            {data.us.rank ?? "–"}
            <small> of {data.us.teamCount}</small>
          </strong>
          <span>{data.ourTeam}'s rank</span>
        </div>
        <div className="stat">
          <strong>{data.us.wins === null ? "–" : `${data.us.wins}–${data.us.losses}${data.us.ties ? `–${data.us.ties}` : ""}`}</strong>
          <span>record</span>
        </div>
        <div className="stat">
          <strong>
            {data.coverage.teamsObserved}
            <small> of {data.coverage.teamCount}</small>
          </strong>
          <span>teams watched</span>
        </div>
        <div className="stat">
          <strong>
            {data.coverage.teamsPitScouted}
            <small> of {data.coverage.teamCount}</small>
          </strong>
          <span>pits visited</span>
        </div>
        <div className="stat">
          <strong>{data.coverage.entries}</strong>
          <span>entries from {data.coverage.matchesWithEntries} matches</span>
        </div>
      </div>

      <Panel title={`${data.ourTeam}'s next matches`}>
        {data.nextMatches.length === 0 ? (
          <p className="dim">No more matches on the schedule for {data.ourTeam}.</p>
        ) : (
          <ul className="next-list">
            {data.nextMatches.map((match) => {
              const ours = match.favourite === match.alliance;
              return (
                <li key={match.matchKey}>
                  <Link to={`/strategy/matches/${match.matchKey}`} className="next-row">
                    <span className="next-when">
                      <strong>{match.label}</strong>
                      <span className="cell-sub">{match.startsAt ? `${formatTime(match.startsAt)}, in ${formatCountdown(match.startsAt - now)}` : "No time yet"}</span>
                    </span>
                    <span className="next-teams">
                      <span className={`alliance alliance-${match.alliance}`}>
                        <span className="dim">With</span>
                        {match.partners.map((n) => (
                          <span key={n} className="team">
                            {n}
                          </span>
                        ))}
                      </span>
                      <span className={`alliance alliance-${match.alliance === "red" ? "blue" : "red"}`}>
                        <span className="dim">Against</span>
                        {match.opponents.map((n) => (
                          <span key={n} className="team">
                            {n}
                          </span>
                        ))}
                      </span>
                    </span>
                    {match.favourite ? <Chip tone={match.favourite === "even" ? "dim" : ours ? "good" : "warn"}>{match.favourite === "even" ? "Too close to call" : ours ? "We are favoured" : "They are favoured"}</Chip> : <Chip tone="dim">Not enough data</Chip>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Brief kind="event" subject="summary" title="Event digest" />

      <div className="split">
        <Panel title="Strongest robots so far" aside="Points a match, from scouting">
          {data.topTeams.length === 0 ? (
            <p className="dim">Nothing yet. This fills in as scouts submit entries.</p>
          ) : (
            <table className="table table-compact">
              <tbody>
                {data.topTeams.map((team) => (
                  <tr key={team.teamNumber}>
                    <td>
                      <TeamLink number={team.teamNumber} name={team.name} ours={team.teamNumber === data.ourTeam} />
                    </td>
                    <td className="num dim">{team.matchesObserved} seen</td>
                    <td className="num">{formatNumber(team.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Changing form" aside={headline ? `${headline.short}, last three matches against their average` : undefined}>
          {data.movers.length === 0 ? (
            <p className="dim">No clear changes yet. A team needs four watched matches before a trend shows.</p>
          ) : (
            <table className="table table-compact">
              <tbody>
                {data.movers.map((team) => (
                  <tr key={team.teamNumber}>
                    <td>
                      <TeamLink number={team.teamNumber} name={team.name} />
                    </td>
                    <td className={`num ${team.direction === "up" ? "on" : "off"}`}>
                      {team.direction === "up" ? "Up" : "Down"} {formatNumber(Math.abs(team.change))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {data.watchList.length > 0 ? (
        <Panel title="Treat these figures with care">
          <ul className="flag-list">
            {data.watchList.map((team) => (
              <li key={team.teamNumber}>
                <TeamLink number={team.teamNumber} name={team.name} />
                <span className="cell-sub">{team.flags.join(" ")}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="row">
        <a className="btn btn-small" href={`/api/hub/events/${event!.eventKey}/export/teams.csv`}>
          Download team figures
        </a>
        <a className="btn btn-small" href={`/api/hub/events/${event!.eventKey}/export/entries.csv`}>
          Download all entries
        </a>
      </div>
    </>
  );
}

/* Teams table */

type SortKey = string;

function sortValue(team: CompiledTeam, key: SortKey): number | null {
  switch (key) {
    case "team":
      return team.teamNumber;
    case "seen":
      return team.matchesObserved;
    case "points":
      return team.estPoints;
    case "rank":
      return team.stats.rank;
    case "opr":
      return team.stats.opr;
    case "epa":
      return team.stats.epa;
    default:
      return team.metrics[key]?.value ?? null;
  }
}

function TeamsTable() {
  const { game } = useSession();
  const compiled = useCompiledTeams();
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "points", down: true });
  const [search, setSearch] = useState("");
  const [onlySeen, setOnlySeen] = useState(false);

  const teams = compiled.data?.teams ?? [];
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return teams
      .filter((t) => (!needle || String(t.teamNumber).includes(needle) || t.name.toLowerCase().includes(needle)) && (!onlySeen || t.matchesObserved > 0))
      .sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (va === null && vb === null) return a.teamNumber - b.teamNumber;
        if (va === null) return 1;
        if (vb === null) return -1;
        return sort.down ? vb - va : va - vb;
      });
  }, [teams, sort, search, onlySeen]);

  if (compiled.loading) return <Loading />;
  if (compiled.error) return <Notice tone="error">{describeError(compiled.error)}</Notice>;
  if (teams.length === 0) return <Empty title="No teams yet.">Teams appear once the event is set up in Admin.</Empty>;

  const head = (key: SortKey, label: string, title?: string, lowFirst = false) => (
    <th
      className={`num sortable${sort.key === key ? " is-sorted" : ""}`}
      title={title}
      aria-sort={sort.key === key ? (sort.down ? "descending" : "ascending") : undefined}
      onClick={() => setSort((s) => (s.key === key ? { key, down: !s.down } : { key, down: !lowFirst }))}
    >
      {label}
      {sort.key === key ? (sort.down ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <>
      <div className="row">
        <input className="input" style={{ flex: 1, minWidth: 200, maxWidth: 360 }} placeholder="Find a team by number or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className={`pill${onlySeen ? " is-on" : ""}`} aria-pressed={onlySeen} onClick={() => setOnlySeen((v) => !v)}>
          Only teams we have watched
        </button>
      </div>
      <Panel>
        <div className="table-scroll">
          <table className="table table-compact table-click teams-table">
            <thead>
              <tr>
                <th className={`sortable${sort.key === "team" ? " is-sorted" : ""}`} onClick={() => setSort((s) => ({ key: "team", down: s.key === "team" ? !s.down : false }))}>
                  Team
                </th>
                {head("seen", "Seen", "Matches a scout has watched this robot in")}
                {head("points", "Points", "Rough points a match, from what scouts recorded")}
                {game.metrics.map((metric) => head(metric.key, metric.short, metric.label))}
                {head("rank", "Rank", "Official ranking", true)}
                {head("opr", "OPR", "Offensive power rating from The Blue Alliance")}
                {head("epa", "EPA", "Expected points from Statbotics")}
              </tr>
            </thead>
            <tbody>
              {rows.map((team) => {
                const trend = team.metrics[game.headlineMetric]?.trend ?? null;
                return (
                  <tr key={team.teamNumber} onClick={() => navigate(`/strategy/teams/${team.teamNumber}`)}>
                    <td className="team-cell">
                      <strong className={team.teamNumber === compiled.data!.ourTeam ? "team-ours" : undefined}>{team.teamNumber}</strong> <span className="dim">{team.name}</span>
                      {team.flags.length ? (
                        <span className="flag-dot" title={team.flags.map((f) => f.text).join(" ")}>
                          !
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{team.matchesObserved || <span className="dim">0</span>}</td>
                    <td className="num">
                      <strong>{formatNumber(team.estPoints)}</strong>
                    </td>
                    {game.metrics.map((metric) => (
                      <td key={metric.key} className="num">
                        {formatMetric(metric, team.metrics[metric.key]?.value)}
                        {metric.key === game.headlineMetric && trend !== null && Math.abs(trend) >= 1 ? <span className={trend > 0 ? "trend on" : "trend off"}>{trend > 0 ? "▲" : "▼"}</span> : null}
                      </td>
                    ))}
                    <td className="num">{team.stats.rank ?? "–"}</td>
                    <td className="num">{formatNumber(team.stats.opr)}</td>
                    <td className="num">{formatNumber(team.stats.epa)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="panel-note">
          Ratings run from 1 (bad) to 4 (exceptional). A ▲ or ▼ means the last three matches are clearly above or below the team's average. An exclamation mark means there is a reason to
          treat the figures with care; open the team to see why.
        </p>
      </Panel>
    </>
  );
}

/* Team detail */

interface TeamDetailData {
  team: CompiledTeam;
  history: Array<{
    matchKey: string;
    label: string;
    alliance: "red" | "blue";
    partners: number[];
    opponents: number[];
    allianceScore: number | null;
    opponentScore: number | null;
    played: boolean;
    entries: Array<{ id: string; scout: string; data: EntryData; points: number | null }>;
  }>;
  notes: Array<{ label: string; scout: string; text: string }>;
  pitEntries: Array<{ id: string; scout: string; data: EntryData; submittedAt: string | null }>;
}

function metricFromEntries(game: GameDefinition, key: string, entries: Array<{ data: EntryData }>): number | null {
  const metric = game.metrics.find((m) => m.key === key);
  if (!metric) return null;
  const values = entries
    .map((entry) => {
      const raw = entry.data[metric.agg.field];
      switch (metric.agg.kind) {
        case "avg":
        case "max":
          return typeof raw === "number" ? raw : null;
        case "avgPoints":
          return typeof raw === "string" ? (metric.agg.points[raw] ?? 0) : null;
        default:
          return null;
      }
    })
    .filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function TeamDetail({ teamNumber }: { teamNumber: number }) {
  const { event, game } = useSession();
  const detail = useQuery<TeamDetailData>(event ? `analysis:team:${event.eventKey}:${teamNumber}` : null, () => api(`/events/${event!.eventKey}/analysis/teams/${teamNumber}`), TAGS);
  const chartable = game.metrics.filter((m) => m.agg.kind === "avg" || m.agg.kind === "avgPoints");
  const [chartKey, setChartKey] = useState(game.headlineMetric);

  if (detail.loading || !detail.data) {
    return (
      <Page title={`Team ${teamNumber}`} back="/strategy/teams">
        {detail.error ? <Notice tone="error">{(detail.error as { code?: string }).code === "team_not_found" ? "This team is not at this event." : describeError(detail.error)}</Notice> : <Loading />}
      </Page>
    );
  }
  const { team, history, notes, pitEntries } = detail.data;
  const watched = history.filter((h) => h.entries.length > 0);
  const upcoming = history.filter((h) => !h.played);
  const chartMetric = chartable.find((m) => m.key === chartKey) ?? chartable[0];
  const pitFields = allFields(game.pitForm);
  const matchFields = allFields(game.matchForm);
  const problemField = matchFields.find((f) => f.key === "difficulties");

  return (
    <Page
      title={`${team.teamNumber} ${team.name}`}
      lead={[team.location, team.stats.rank ? `Ranked ${team.stats.rank}` : null, record(team.stats) ? `record ${record(team.stats)}` : null].filter(Boolean).join(". ") || undefined}
      back="/strategy/teams"
      wide
    >
      {team.flags.length > 0 ? (
        <Notice tone="warn">
          <strong>Treat these figures with care.</strong>
          <ul>
            {team.flags.map((flag) => (
              <li key={flag.text}>{flag.text}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {team.matchesObserved === 0 ? (
        <Empty title="No scout has watched this robot yet.">Its figures appear here as soon as an entry is submitted.</Empty>
      ) : (
        <>
          <div className="tiles">
            <div className="tile tile-main">
              <span>Points a match</span>
              <strong>{formatNumber(team.estPoints)}</strong>
              <small>from {team.matchesObserved} matches watched</small>
            </div>
            {game.metrics.map((metric) => {
              const m = team.metrics[metric.key];
              return (
                <div className="tile" key={metric.key}>
                  <span>{metric.label}</span>
                  <strong>{formatMetric(metric, m.value)}</strong>
                  <small>
                    {m.matches === 0
                      ? "No evidence"
                      : metric.percent || metric.agg.kind === "ratingAvg"
                        ? `from ${m.matches} match${m.matches === 1 ? "" : "es"}`
                        : `best ${formatMetric(metric, m.best)}, worst ${formatMetric(metric, m.worst)}${m.last3 !== null ? `, last three ${formatMetric(metric, m.last3)}` : ""}`}
                  </small>
                </div>
              );
            })}
          </div>

          {chartMetric ? (
            <Panel
              title={`${chartMetric.label.replace(/ per match$/, "")} in each match`}
              aside={
                <select className="chart-select" value={chartMetric.key} onChange={(e) => setChartKey(e.target.value)} aria-label="Figure to chart">
                  {chartable.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.short}
                    </option>
                  ))}
                </select>
              }
            >
              <BarChart
                title={chartMetric.label}
                format={(v) => formatMetric(chartMetric, v)}
                bars={watched.map((row) => ({
                  label: row.label.replace("Qual ", "Q"),
                  value: metricFromEntries(game, chartMetric.key, row.entries),
                  detail: row.entries.length > 1 ? `average of ${row.entries.length} scouts` : `by ${row.entries[0].scout}`,
                }))}
              />
            </Panel>
          ) : null}
        </>
      )}

      {team.matchesObserved > 0 || team.pit ? <Brief kind="team" subject={String(team.teamNumber)} title="Profile" /> : null}

      <div className="split">
        <Panel title="Public figures">
          <dl className="facts">
            <div>
              <dt>Rank</dt>
              <dd>{team.stats.rank ?? "–"}</dd>
            </div>
            <div>
              <dt>Record</dt>
              <dd>{record(team.stats) || "–"}</dd>
            </div>
            <div>
              <dt>OPR</dt>
              <dd>{formatNumber(team.stats.opr)}</dd>
            </div>
            <div>
              <dt>EPA</dt>
              <dd>{formatNumber(team.stats.epa)}</dd>
            </div>
          </dl>
          {Object.keys(team.problems).length > 0 && problemField?.type === "multi" ? (
            <p className="panel-note">
              Problems seen: {Object.entries(team.problems).map(([key, count]) => `${problemField.options.find((o) => o.value === key)?.label.toLowerCase() ?? key} (${count})`).join(", ")}.
            </p>
          ) : null}
        </Panel>
        <Panel title="Coming up">
          {upcoming.length === 0 ? (
            <p className="dim">No more matches on the schedule.</p>
          ) : (
            <ul className="flag-list">
              {upcoming.slice(0, 5).map((row) => (
                <li key={row.matchKey}>
                  <Link to={`/strategy/matches/${row.matchKey}`}>
                    <strong>{row.label}</strong>
                  </Link>
                  <span className="cell-sub">
                    With {row.partners.join(", ")} against {row.opponents.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="From the pits" aside={team.pitScouts.length ? `Visited by ${team.pitScouts.join(", ")}` : undefined}>
        {team.pit ? (
          <dl className="facts">
            {pitFields
              .filter((f) => team.pit![f.key] !== undefined)
              .map((field) => (
                <div key={field.key} className={field.type === "text" && field.long ? "fact-wide" : undefined}>
                  <dt>{field.label}</dt>
                  <dd>{formatValue(field, team.pit![field.key])}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="dim">Nobody has visited this team's pit yet.{pitEntries.length ? "" : ""}</p>
        )}
      </Panel>

      {notes.length > 0 ? (
        <Panel title="Scout notes">
          <ul className="notes">
            {notes.map((note, i) => (
              <li key={i}>
                <p>{note.text}</p>
                <span className="cell-sub">
                  {note.label}, {note.scout}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {watched.length > 0 ? (
        <Panel title="Match by match">
          <div className="table-scroll">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Scout</th>
                  {matchFields
                    .filter((f) => f.type !== "text" && f.type !== "multi")
                    .map((field) => (
                      <th key={field.key} className={field.type === "counter" ? "num" : undefined}>
                        {field.label}
                      </th>
                    ))}
                  <th className="num">Points</th>
                  <th className="num">Result</th>
                </tr>
              </thead>
              <tbody>
                {watched.flatMap((row) =>
                  row.entries.map((entry, i) => (
                    <tr key={entry.id}>
                      <td className="nowrap">
                        {i === 0 ? (
                          <Link to={`/strategy/matches/${row.matchKey}`}>
                            <strong>{row.label}</strong>
                          </Link>
                        ) : null}
                      </td>
                      <td>{entry.scout}</td>
                      {matchFields
                        .filter((f) => f.type !== "text" && f.type !== "multi")
                        .map((field) => (
                          <td key={field.key} className={field.type === "counter" ? "num" : undefined}>
                            {formatValue(field, entry.data[field.key])}
                          </td>
                        ))}
                      <td className="num">{entry.points ?? "–"}</td>
                      <td className="num nowrap">
                        {i === 0 && row.allianceScore !== null && row.opponentScore !== null ? (
                          <span className={row.allianceScore > row.opponentScore ? "on" : row.allianceScore < row.opponentScore ? "off" : undefined}>
                            {row.allianceScore}–{row.opponentScore}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}

/* Match analysis */

interface OutlookTeam {
  teamNumber: number;
  name: string;
  basis: "scouting" | "epa" | "opr" | "none";
  points: number | null;
  matchesObserved: number;
  flags: number;
}

interface AllianceOutlook {
  teams: OutlookTeam[];
  inputs: Record<string, number>;
  complete: boolean;
  expectedScore: number | null;
  rp: RpResult | null;
}

export interface MatchAnalysis {
  outlook: { matchKey: string; label: string; red: AllianceOutlook; blue: AllianceOutlook; favourite: "red" | "blue" | "even" | null; notes: string[] };
  teams: CompiledTeam[];
  ourTeam: number;
}

const BASIS: Record<OutlookTeam["basis"], string> = { scouting: "", epa: "from EPA", opr: "from OPR", none: "nothing known" };

function AllianceCard({ side, outlook, teams, ourTeam }: { side: "red" | "blue"; outlook: AllianceOutlook; teams: CompiledTeam[]; ourTeam: number }) {
  const { game } = useSession();
  const shown = game.metrics.filter((m) => ["scoring_cycles", game.headlineMetric, "climb_points", "defence_rating"].includes(m.key)).slice(0, 4);
  const columns = shown.length ? shown : game.metrics.slice(0, 4);
  return (
    <Panel
      tone={side}
      title={side === "red" ? "Red alliance" : "Blue alliance"}
      aside={outlook.expectedScore !== null ? <span className="expected">about {Math.round(outlook.expectedScore)} points</span> : "Not enough data"}
    >
      <div className="table-scroll">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">Points</th>
              {columns.map((metric) => (
                <th key={metric.key} className="num" title={metric.label}>
                  {metric.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outlook.teams.map((slot) => {
              const team = teams.find((t) => t.teamNumber === slot.teamNumber);
              return (
                <tr key={slot.teamNumber}>
                  <td>
                    <TeamLink number={slot.teamNumber} name={slot.name} ours={slot.teamNumber === ourTeam} />
                    <span className="cell-sub">
                      {slot.matchesObserved ? `${slot.matchesObserved} watched` : "Not watched yet"}
                      {slot.flags ? ", figures uncertain" : ""}
                    </span>
                  </td>
                  <td className="num">
                    <strong>{formatNumber(slot.points)}</strong>
                    {BASIS[slot.basis] ? <span className="cell-sub">{BASIS[slot.basis]}</span> : null}
                  </td>
                  {columns.map((metric) => (
                    <td key={metric.key} className="num">
                      {formatMetric(metric, team?.metrics[metric.key]?.value)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {outlook.rp ? (
        <dl className="calc-result">
          {game.allianceInputs.map((input) => (
            <div key={input.key}>
              <dt>Expected {input.label.toLowerCase()}</dt>
              <dd>{Math.round(outlook.inputs[input.key] ?? 0)}</dd>
            </div>
          ))}
          {outlook.rp.bonuses.map((bonus) => (
            <div key={bonus.id} className={bonus.earned ? "earned" : ""}>
              <dt>{bonus.label}</dt>
              <dd>{bonus.earned ? `likely, +${bonus.rp}` : `${Math.ceil(bonus.need - bonus.have)} short`}</dd>
            </div>
          ))}
          <div className="calc-total">
            <dt>Ranking points expected</dt>
            <dd>{outlook.rp.total}</dd>
          </div>
        </dl>
      ) : (
        <p className="panel-note">Ranking points are worked out once every robot in the match has been watched.</p>
      )}
    </Panel>
  );
}

export function useMatchAnalysis(matchKey: string | null) {
  const { event } = useSession();
  return useQuery<MatchAnalysis>(event && matchKey ? `analysis:match:${event.eventKey}:${matchKey}` : null, () => api(`/events/${event!.eventKey}/analysis/matches/${matchKey}`), TAGS);
}

function MatchPicker({ matches, current, ourTeam, nextKey }: { matches: ScheduleMatch[]; current: string | null; ourTeam: number; nextKey: string | undefined }) {
  const [all, setAll] = useState(false);
  const mine = matches.filter((m) => [...m.red, ...m.blue].some((t) => t.teamNumber === ourTeam));
  const list = all || mine.length === 0 ? matches : mine;
  return (
    <div className="row">
      <label className="field" style={{ minWidth: 220 }}>
        <span>Match</span>
        <select value={current ?? ""} onChange={(e) => navigate(`/strategy/matches/${e.target.value}`)}>
          {current && !list.some((m) => m.matchKey === current) ? <option value={current}>{matches.find((m) => m.matchKey === current)?.label}</option> : null}
          {list.map((match) => (
            <option key={match.matchKey} value={match.matchKey}>
              {match.label}
              {match.matchKey === nextKey ? " (next)" : ""}
              {match.redScore !== null ? ` · ${match.redScore}–${match.blueScore}` : ""}
            </option>
          ))}
        </select>
      </label>
      {mine.length > 0 ? (
        <button type="button" className={`pill${all ? "" : " is-on"}`} aria-pressed={!all} onClick={() => setAll((v) => !v)}>
          Only {ourTeam}
        </button>
      ) : null}
    </div>
  );
}

function Matches({ matchKey }: { matchKey: string | null }) {
  const schedule = useSchedule();
  const now = useNow();
  const clock = useMatchClock(schedule.data?.matches, now);
  const matches = schedule.data?.matches ?? [];
  const ourTeam = schedule.data?.ourTeam ?? 1884;
  const ourNext = clock?.upcoming.find((m) => [...m.red, ...m.blue].some((t) => t.teamNumber === ourTeam));
  const chosen = matchKey ?? ourNext?.matchKey ?? clock?.upcoming[0]?.matchKey ?? matches[matches.length - 1]?.matchKey ?? null;
  const analysis = useMatchAnalysis(chosen);
  const match = matches.find((m) => m.matchKey === chosen);

  if (schedule.loading) return <Loading />;
  if (matches.length === 0) return <Empty title="No matches on the schedule yet." />;

  const start = chosen ? clock?.startsAt[chosen] : null;
  const data = analysis.data;
  const scored = match && match.redScore !== null && match.blueScore !== null;

  return (
    <>
      <MatchPicker matches={matches} current={chosen} ourTeam={ourTeam} nextKey={clock?.upcoming[0]?.matchKey} />
      {analysis.loading ? <Loading /> : null}
      {analysis.error ? <Notice tone="error">{describeError(analysis.error)}</Notice> : null}
      {data && match ? (
        <>
          <div className="match-head">
            <h2>{data.outlook.label}</h2>
            <span className="dim">
              {scored
                ? `Played. Red ${match.redScore}, blue ${match.blueScore}.`
                : start
                  ? start > now
                    ? `Starts at ${formatTime(start)}, in ${formatCountdown(start - now)}`
                    : "Under way"
                  : "No time yet"}
            </span>
            {data.outlook.favourite ? (
              <Chip tone={data.outlook.favourite === "even" ? "dim" : data.outlook.favourite}>
                {data.outlook.favourite === "even" ? "Too close to call" : `${data.outlook.favourite === "red" ? "Red" : "Blue"} favoured`}
              </Chip>
            ) : null}
          </div>
          {data.outlook.notes.length > 0 ? (
            <Notice>
              <ul className="plain-list">
                {data.outlook.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="split">
            <AllianceCard side="red" outlook={data.outlook.red} teams={data.teams} ourTeam={data.ourTeam} />
            <AllianceCard side="blue" outlook={data.outlook.blue} teams={data.teams} ourTeam={data.ourTeam} />
          </div>
          <Brief key={data.outlook.matchKey} kind="match" subject={data.outlook.matchKey} title="Match brief" />
        </>
      ) : null}
    </>
  );
}

export function StrategyPage({ rest }: { rest: string[] }) {
  const { event } = useSession();
  if (!event) {
    return (
      <Page title="Strategy">
        <Empty title="No event is set up yet.">A lead sets up the event in Admin.</Empty>
      </Page>
    );
  }
  if (rest[0] === "teams" && rest[1]) return <TeamDetail key={rest[1]} teamNumber={Number(rest[1])} />;
  const tab = rest[0] ?? "overview";
  return (
    <Page title="Strategy" wide>
      <Tabs active={tab} />
      {tab === "overview" ? <Overview /> : null}
      {tab === "teams" ? <TeamsTable /> : null}
      {tab === "matches" ? <Matches matchKey={rest[1] ?? null} /> : null}
    </Page>
  );
}
