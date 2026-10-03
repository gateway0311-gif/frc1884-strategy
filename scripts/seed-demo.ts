// Creates a made-up event whose schedule straddles the current time, so the
// hub can be tried out end to end without a real competition:
//
//   npm run seed:demo
//
// It only touches the event "2026demo" and makes it the active event.
import { db } from "../src/db/client.js";
import { setSetting } from "../src/hub/settings.js";
import crypto from "node:crypto";
import { saveEntry } from "../src/hub/entries.js";
import { savePit } from "../src/hub/pit.js";
import { saveManualMatch } from "../src/hub/schedule.js";

const EVENT = "2026demo";
const TEAMS: Array<[number, string]> = [
  [1884, "Griffins"], [148, "Robowranglers"], [254, "The Cheesy Poofs"], [341, "Miss Daisy"], [604, "Quixilver"], [868, "TechHOUNDS"],
  [930, "Mukwonago BEARs"], [973, "Greybots"], [1323, "MadTown Robotics"], [1678, "Citrus Circuits"], [1796, "RoboTigers"], [2056, "OP Robotics"],
  [2067, "Apple Pi"], [2910, "Jack in the Bot"], [3005, "RoboChargers"], [3310, "Black Hawk Robotics"], [4414, "HighTide"], [5414, "Pearadox"],
  [5736, "Kingsmen Robotics"], [6036, "Peninsula Robotics"], [6328, "Mechanical Advantage"], [8046, "LakerBots"], [9128, "ITKAN Robotics"], [10935, "Krono"],
];
const MATCHES = 40;
const SPACING_MIN = 8;
const PLAYED = 14;
const SCOUTS = ["Maya Chen", "Sam Okafor", "Priya Nair", "Leo Brandt", "Hana Sato", "Tom Reyes"];

// Small repeatable random number generator so the demo looks the same each time.
let seed = 1884;
function random(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

db.transaction(() => {
  db.prepare(`DELETE FROM events WHERE event_key = ?`).run(EVENT);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO events (event_key, name, season, location, start_date, end_date, source, game_id)
     VALUES (?, 'Demo event', 2026, 'Made-up data for trying the hub', ?, ?, 'demo', 'rebuilt2026')`
  ).run(EVENT, today, today);
  for (const [number, name] of TEAMS) {
    db.prepare(
      `INSERT INTO teams (team_number, name, source) VALUES (?, ?, 'demo')
       ON CONFLICT(team_number) DO UPDATE SET name = CASE WHEN teams.name LIKE 'Team %' THEN excluded.name ELSE teams.name END`
    ).run(number, name);
    db.prepare(`INSERT OR IGNORE INTO event_teams (event_key, team_number) VALUES (?, ?)`).run(EVENT, number);
  }
})();

// Each made-up team has a fixed ability so its entries tell a consistent story.
const ability = new Map(TEAMS.map(([n]) => [n, { fuel: 8 + random() * 55, climb: random(), defence: random(), improving: random() > 0.7 }]));
const CLIMBS = ["none", "l1", "l2", "l3"];
const RATINGS = ["bad", "average", "good", "exceptional"];
const NOTES = ["Quick cycles from the depot.", "Struggled to get over the bump.", "Played defence for most of teleop.", "Intake jammed twice.", "Very consistent shooter.", "Slow to line up at the tower.", ""];
const record = new Map(TEAMS.map(([n]) => [n, { wins: 0, losses: 0, ties: 0, rp: 0, played: 0 }]));

const start = Date.now() - (PLAYED * SPACING_MIN - 3) * 60_000;
const numbers = TEAMS.map(([n]) => n);
for (let i = 0; i < MATCHES; i++) {
  const pool = [...numbers].sort(() => random() - 0.5).slice(0, 6);
  const plannedAt = new Date(start + i * SPACING_MIN * 60_000).toISOString();
  const matchKey = saveManualMatch(EVENT, { compLevel: "qm", matchNumber: i + 1, plannedAt, red: pool.slice(0, 3), blue: pool.slice(3) });
  db.prepare(`UPDATE matches SET source = 'demo' WHERE match_key = ?`).run(matchKey);
  if (i >= PLAYED) continue;

  const totals = { red: 0, blue: 0 };
  pool.forEach((team, slot) => {
    const a = ability.get(team)!;
    const growth = a.improving ? 1 + i * 0.04 : 1;
    const fuel = Math.max(0, Math.round(a.fuel * growth * (0.7 + random() * 0.6)));
    const autoFuel = Math.round(fuel * 0.15);
    const climbIndex = random() < a.climb ? 1 + Math.floor(random() * 3 * a.climb + 0.3) : 0;
    const climb = CLIMBS[Math.min(3, climbIndex)];
    const points = fuel + autoFuel + [0, 10, 20, 30][CLIMBS.indexOf(climb)];
    totals[slot < 3 ? "red" : "blue"] += points;
    // Leave a few robots unwatched so the demo shows gaps too.
    if (team === 1884 || random() < 0.12) return;
    const data = {
      auto_leave: random() < 0.6 ? "bump" : "trench",
      auto_fuel: autoFuel,
      auto_climb: random() < a.climb * 0.3,
      scoring_cycles: Math.max(1, Math.round(fuel / 8)),
      teleop_fuel: fuel,
      ferry_cycles: Math.round(random() * 3),
      active_behaviour: "scores",
      inactive_behaviour: a.defence > 0.6 ? "defends" : "collects",
      enters_opposing_zone: a.defence > 0.6,
      climb_attempted: climb !== "none" || random() < 0.3,
      climb_level: climb,
      scoring_rating: RATINGS[Math.min(3, Math.floor(a.fuel / 16))],
      defence_rating: a.defence > 0.6 ? RATINGS[1 + Math.floor(random() * 3)] : "no_evidence",
      difficulties: random() < 0.12 ? ["jammed"] : [],
      notes: NOTES[Math.floor(random() * NOTES.length)],
    };
    saveEntry({ id: crypto.randomUUID(), eventKey: EVENT, matchKey, teamNumber: team, scout: SCOUTS[slot], data, status: "submitted" });
  });
  const red = Math.round(totals.red * (0.92 + random() * 0.16));
  const blue = Math.round(totals.blue * (0.92 + random() * 0.16));
  db.prepare(`UPDATE matches SET red_score = ?, blue_score = ?, actual_at = ? WHERE match_key = ?`).run(red, blue, plannedAt, matchKey);
  pool.forEach((team, slot) => {
    const r = record.get(team)!;
    const mine = slot < 3 ? red : blue;
    const theirs = slot < 3 ? blue : red;
    r.played += 1;
    if (mine > theirs) (r.wins += 1), (r.rp += 3);
    else if (mine < theirs) r.losses += 1;
    else (r.ties += 1), (r.rp += 1);
  });
}

// Standings, public ratings and pit visits to go with the entries.
const standings = [...record.entries()].sort((a, b) => b[1].rp / Math.max(1, b[1].played) - a[1].rp / Math.max(1, a[1].played));
standings.forEach(([team, r], index) => {
  db.prepare(
    `INSERT OR REPLACE INTO event_rankings (event_key, team_number, rank, ranking_score, wins, losses, ties, matches_played, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(EVENT, team, index + 1, r.played ? r.rp / r.played : 0, r.wins, r.losses, r.ties, r.played, new Date().toISOString());
  const a = ability.get(team)!;
  db.prepare(`INSERT INTO analytics_metrics (event_key, team_number, metric_name, metric_value, source_run) VALUES (?, ?, 'tba.opr', ?, 'demo')`).run(EVENT, team, a.fuel * 1.1 + a.climb * 14);
  db.prepare(`INSERT INTO analytics_metrics (event_key, team_number, metric_name, metric_value, source_run) VALUES (?, ?, 'statbotics.event_epa.total_points_mean', ?, 'demo')`).run(EVENT, team, a.fuel * 1.15 + a.climb * 12);
});
numbers.slice(0, 16).forEach((team, index) => {
  const a = ability.get(team)!;
  savePit({
    id: crypto.randomUUID(),
    eventKey: EVENT,
    teamNumber: team,
    scout: SCOUTS[index % SCOUTS.length],
    status: "submitted",
    data: {
      drivetrain: "swerve",
      weight_lb: 100 + Math.round(random() * 25),
      crossing: random() < 0.5 ? ["bump"] : ["bump", "trench"],
      hopper_capacity: 20 + Math.round(random() * 60),
      fuel_per_second: 2 + Math.round(random() * 6),
      cycles_per_shift: 2,
      fuel_per_cycle: Math.round(a.fuel / 5),
      climb_capability: index % 5 === 0 ? "l3" : CLIMBS[Math.min(3, Math.round(a.climb * 3))],
      plays_defence: a.defence > 0.5,
      struggling_with: index % 4 === 0 ? "Intake reliability" : "",
    },
  });
});

setSetting("active_event_key", EVENT);
console.log(`Demo event ready: ${TEAMS.length} teams, ${MATCHES} matches, ${PLAYED} already played with scouting entries. Open /hub.`);
