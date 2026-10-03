import { useState } from "react";
import { computeRp } from "@shared/games/index";
import { Empty, Link, Page, Panel } from "../components/ui";
import { Icon } from "../components/Icon";
import { useSession } from "../lib/session";
import { FreeBoard } from "../strategy/FreeBoard";
import { SchedulePage } from "./Schedule";

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Scoring() {
  const { game } = useSession();
  const total = game.phases.reduce((sum, p) => sum + p.seconds, 0);
  return (
    <Page title="Scoring" lead={`${game.name} ${game.season}. A match lasts ${clock(game.matchSeconds)}.`} back="/more">
      <Panel title="Match timeline">
        <div className="timeline" role="img" aria-label={game.phases.map((p) => `${p.label} ${p.seconds} seconds`).join(", ")}>
          {game.phases.map((phase) => (
            <div key={phase.id} className="timeline-part" style={{ flexGrow: phase.seconds / total }}>
              <strong>{phase.label}</strong>
              <span>{phase.seconds}s</span>
            </div>
          ))}
        </div>
      </Panel>
      {game.scoring.map((group) => (
        <Panel key={group.id} title={group.label}>
          <table className="table">
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <td>
                    {row.label}
                    {row.detail ? <div className="cell-sub">{row.detail}</div> : null}
                  </td>
                  <td className="num">{row.points} pt{row.points === 1 ? "" : "s"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {group.note ? <p className="panel-note">{group.note}</p> : null}
        </Panel>
      ))}
      <Panel title="Ranking points">
        <table className="table">
          <tbody>
            <tr>
              <td>Win</td>
              <td className="num">{game.outcomeRp.win} RP</td>
            </tr>
            <tr>
              <td>Tie</td>
              <td className="num">{game.outcomeRp.tie} RP</td>
            </tr>
            {game.bonusRp.map((bonus) => (
              <tr key={bonus.id}>
                <td>
                  {bonus.label}
                  <div className="cell-sub">{bonus.description}</div>
                </td>
                <td className="num">+{bonus.rp} RP</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {game.timeline ? (
        <Panel title={game.timeline.title}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Period</th>
                <th>Timer</th>
                <th>Red hub</th>
                <th>Blue hub</th>
              </tr>
            </thead>
            <tbody>
              {game.timeline.rows.map((row) => (
                <tr key={row.period}>
                  <td>{row.period}</td>
                  <td className="dim">{row.timer}</td>
                  <td className={row.red ? "on" : "off"}>{row.red ? "Active" : "Inactive"}</td>
                  <td className={row.blue ? "on" : "off"}>{row.blue ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="panel-note">{game.timeline.note}</p>
        </Panel>
      ) : null}
    </Page>
  );
}

function AllianceCalc({ tone, title, values, onChange, other }: { tone: "red" | "blue"; title: string; values: Record<string, number>; onChange: (v: Record<string, number>) => void; other: Record<string, number> }) {
  const { game } = useSession();
  const result = computeRp(game, values, other);
  return (
    <Panel title={title} tone={tone}>
      <div className="calc-inputs">
        {game.allianceInputs.map((input) => (
          <label key={input.key} className="field">
            <span>{input.label}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={values[input.key] ?? 0}
              onChange={(e) => onChange({ ...values, [input.key]: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        ))}
      </div>
      <dl className="calc-result">
        <div>
          <dt>Score</dt>
          <dd>{result.score}</dd>
        </div>
        <div>
          <dt>{result.outcome === "win" ? "Win" : result.outcome === "tie" ? "Tie" : "Loss"}</dt>
          <dd>+{result.outcomeRp}</dd>
        </div>
        {result.bonuses.map((bonus) => (
          <div key={bonus.id} className={bonus.earned ? "earned" : ""}>
            <dt>{bonus.label}</dt>
            <dd>{bonus.earned ? `+${bonus.rp}` : `${bonus.need - bonus.have} short`}</dd>
          </div>
        ))}
        <div className="calc-total">
          <dt>Ranking points</dt>
          <dd>{result.total}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function RpCalculator() {
  const [red, setRed] = useState<Record<string, number>>({});
  const [blue, setBlue] = useState<Record<string, number>>({});
  return (
    <Page title="Ranking point calculator" lead="Enter what each alliance scores to see the ranking points it earns." back="/more">
      <div className="split">
        <AllianceCalc tone="red" title="Red alliance" values={red} onChange={setRed} other={blue} />
        <AllianceCalc tone="blue" title="Blue alliance" values={blue} onChange={setBlue} other={red} />
      </div>
    </Page>
  );
}

function Rules() {
  const { game } = useSession();
  return (
    <Page title="Rules to remember" lead={`${game.name} ${game.season}`} back="/more">
      {game.rules.map((rule) => (
        <Panel key={rule.id} title={`${rule.id} ${rule.title}`} aside={rule.category}>
          <p>{rule.description}</p>
          <p className="panel-note">Penalty: {rule.penalty}</p>
        </Panel>
      ))}
    </Page>
  );
}

const LINKS = [
  { to: "/more/schedule", label: "Schedule", detail: "Every match, with times that follow the field" },
  { to: "/more/scoring", label: "Scoring", detail: "Points, ranking points and the match timeline" },
  { to: "/more/rp", label: "Ranking point calculator", detail: "Work out ranking points for both alliances" },
  { to: "/more/rules", label: "Rules to remember", detail: "The rules that cost matches" },
  { to: "/more/board", label: "Free strategy board", detail: "Sketch an idea with any six teams" },
];

export function MorePage({ rest }: { rest: string[] }) {
  switch (rest[0]) {
    case "schedule":
      return <SchedulePage />;
    case "scoring":
      return <Scoring />;
    case "rp":
      return <RpCalculator />;
    case "rules":
      return <Rules />;
    case "board":
      return <FreeBoard />;
    case undefined:
      return (
        <Page title="More">
          <div className="link-list">
            {LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="link-row">
                <span>
                  <strong>{link.label}</strong>
                  <span className="cell-sub">{link.detail}</span>
                </span>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
        </Page>
      );
    default:
      return (
        <Page title="Not found" back="/more">
          <Empty title="There is nothing at this address." />
        </Page>
      );
  }
}
