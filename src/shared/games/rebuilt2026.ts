import type { GameDefinition } from "./types.js";

// REBUILT (2026). Values match the rules as used in the team's strategy app.

const CLIMB_LEVELS = [
  { value: "none", label: "None" },
  { value: "l1", label: "Level 1" },
  { value: "l2", label: "Level 2" },
  { value: "l3", label: "Level 3" },
];

export const TELEOP_CLIMB_POINTS: Record<string, number> = { none: 0, l1: 10, l2: 20, l3: 30 };
export const AUTO_CLIMB_POINTS = 15;

export const rebuilt2026: GameDefinition = {
  id: "rebuilt2026",
  season: 2026,
  name: "REBUILT",
  matchSeconds: 160,
  phases: [
    { id: "auto", label: "Auto", seconds: 20 },
    { id: "transition", label: "Transition", seconds: 10 },
    { id: "shifts", label: "Shifts ×4", seconds: 100 },
    { id: "endgame", label: "End game", seconds: 30 },
  ],
  scoring: [
    {
      id: "fuel",
      label: "Fuel",
      note: "Win auto and the opponents' hub is inactive in shift 1. Hubs then alternate every 25 s. Both are active in the end game.",
      rows: [
        { label: "Fuel in an active hub", points: 1 },
        { label: "Fuel in an inactive hub", points: 0 },
      ],
    },
    {
      id: "climb",
      label: "Tower climb",
      note: "A robot that earns auto Level 1 can still earn teleop climb points.",
      rows: [
        { label: "Auto Level 1", detail: "Off the carpet and tower base. Two robots at most.", points: AUTO_CLIMB_POINTS },
        { label: "Teleop Level 1", detail: "Off the carpet and tower base.", points: 10 },
        { label: "Teleop Level 2", detail: "Bumpers completely above the low rung.", points: 20 },
        { label: "Teleop Level 3", detail: "Bumpers completely above the mid rung.", points: 30 },
      ],
    },
  ],
  allianceInputs: [
    { key: "fuel", label: "Fuel" },
    { key: "climb", label: "Climb points" },
  ],
  outcomeRp: { win: 3, tie: 1, loss: 0 },
  bonusRp: [
    { id: "energized", label: "Energized", description: "100 or more fuel scored in active hubs.", input: "fuel", threshold: 100, rp: 1 },
    { id: "supercharged", label: "Supercharged", description: "360 or more fuel scored in active hubs.", input: "fuel", threshold: 360, rp: 1 },
    { id: "traversal", label: "Traversal", description: "50 or more tower points.", input: "climb", threshold: 50, rp: 1 },
  ],
  allianceScore(totals) {
    return (totals.fuel ?? 0) + (totals.climb ?? 0);
  },
  timeline: {
    title: "Hub activation if red wins auto",
    note: "If blue wins auto, swap the two columns.",
    rows: [
      { period: "Auto", seconds: 20, timer: "0:20–0:00", red: true, blue: true },
      { period: "Transition", seconds: 10, timer: "2:20–2:10", red: true, blue: true },
      { period: "Shift 1", seconds: 25, timer: "2:10–1:45", red: false, blue: true },
      { period: "Shift 2", seconds: 25, timer: "1:45–1:20", red: true, blue: false },
      { period: "Shift 3", seconds: 25, timer: "1:20–0:55", red: false, blue: true },
      { period: "Shift 4", seconds: 25, timer: "0:55–0:30", red: true, blue: false },
      { period: "End game", seconds: 30, timer: "0:30–0:00", red: true, blue: true },
    ],
  },
  rules: [
    { id: "G403", title: "Auto crossing", description: "A robot cannot cross the centre line and contact an opponent in auto.", penalty: "Major foul", category: "Auto" },
    { id: "G407", title: "Score from the alliance zone", description: "A robot must be in its alliance zone to score in the hub.", penalty: "Major foul", category: "Scoring" },
    { id: "G418", title: "Five-second pin", description: "A robot cannot pin an opponent for more than 5 seconds, and must back off for 3 seconds before pinning again.", penalty: "Foul", category: "Defence" },
    { id: "G420", title: "Climb protection", description: "No contact with an opponent on the tower in the last 30 seconds.", penalty: "Major foul and the opponent is awarded Level 3", category: "End game" },
  ],
  matchForm: [
    {
      id: "auto",
      label: "Auto",
      fields: [
        {
          key: "auto_leave",
          label: "Leaves the alliance zone",
          type: "select",
          required: true,
          options: [
            { value: "stays", label: "Stays" },
            { value: "bump", label: "Over the bump" },
            { value: "trench", label: "Through the trench" },
            { value: "no_show", label: "Did not move" },
          ],
        },
        { key: "auto_fuel", label: "Fuel scored in auto", type: "counter", steps: [1, 5], max: 200 },
        { key: "auto_climb", label: "Climbed Level 1 in auto", type: "toggle" },
      ],
    },
    {
      id: "teleop",
      label: "Teleop",
      fields: [
        { key: "scoring_cycles", label: "Scoring cycles", help: "One cycle is one trip that ends with shooting into the hub.", type: "counter", steps: [1], max: 60, required: true },
        { key: "teleop_fuel", label: "Fuel scored", help: "Best estimate of fuel that went in.", type: "counter", steps: [1, 5, 10], max: 600 },
        { key: "ferry_cycles", label: "Ferrying cycles", help: "Trips moving fuel to a partner or back to the alliance zone.", type: "counter", steps: [1], max: 60 },
        {
          key: "active_behaviour",
          label: "When its hub is active",
          type: "select",
          options: [
            { value: "scores", label: "Scores" },
            { value: "ferries", label: "Ferries" },
            { value: "defends", label: "Defends" },
            { value: "idle", label: "Does little" },
          ],
        },
        {
          key: "inactive_behaviour",
          label: "When its hub is inactive",
          type: "select",
          options: [
            { value: "collects", label: "Collects and stores" },
            { value: "ferries", label: "Ferries" },
            { value: "defends", label: "Defends" },
            { value: "scores_anyway", label: "Keeps shooting" },
            { value: "idle", label: "Does little" },
          ],
        },
        { key: "enters_opposing_zone", label: "Goes into the opposing zone", type: "toggle" },
      ],
    },
    {
      id: "endgame",
      label: "End game",
      fields: [
        { key: "climb_attempted", label: "Tried to climb", type: "toggle" },
        { key: "climb_level", label: "Level reached", type: "select", required: true, options: CLIMB_LEVELS },
      ],
    },
    {
      id: "review",
      label: "After the match",
      fields: [
        { key: "scoring_rating", label: "Scoring", type: "rating", required: true },
        { key: "defence_rating", label: "Defence", type: "rating", required: true },
        {
          key: "difficulties",
          label: "Problems",
          type: "multi",
          options: [
            { value: "disabled", label: "Stopped moving" },
            { value: "tipped", label: "Tipped over" },
            { value: "jammed", label: "Jammed" },
            { value: "lost_comms", label: "Lost connection" },
            { value: "fouls", label: "Drew fouls" },
            { value: "no_show", label: "No show" },
          ],
        },
        { key: "notes", label: "Notes", type: "text", long: true },
      ],
    },
  ],
  pitForm: [
    {
      id: "robot",
      label: "Robot",
      fields: [
        {
          key: "drivetrain",
          label: "Drivetrain",
          type: "select",
          options: [
            { value: "swerve", label: "Swerve" },
            { value: "tank", label: "Tank" },
            { value: "mecanum", label: "Mecanum" },
            { value: "other", label: "Other" },
          ],
        },
        { key: "weight_lb", label: "Weight", type: "number", unit: "lb", max: 200 },
        {
          key: "crossing",
          label: "Crosses the field by",
          type: "multi",
          options: [
            { value: "bump", label: "Bump" },
            { value: "trench", label: "Trench" },
          ],
        },
        { key: "hopper_capacity", label: "Hopper capacity", type: "number", unit: "fuel", max: 500 },
        { key: "fuel_per_second", label: "Shooting rate", type: "number", unit: "fuel/s", max: 50 },
      ],
    },
    {
      id: "play",
      label: "How it plays",
      fields: [
        { key: "cycles_per_shift", label: "Cycles per shift", type: "number", max: 20 },
        { key: "fuel_per_cycle", label: "Fuel per cycle", type: "number", max: 200 },
        { key: "auto_description", label: "Auto routine", type: "text", long: true },
        { key: "auto_climb", label: "Can climb in auto", type: "toggle" },
        { key: "climb_capability", label: "Best climb", type: "select", options: CLIMB_LEVELS },
        { key: "plays_defence", label: "Willing to play defence", type: "toggle" },
      ],
    },
    {
      id: "status",
      label: "Right now",
      fields: [
        { key: "struggling_with", label: "Struggling with", type: "text", long: true },
        { key: "changes", label: "Changed since their last event", type: "text", long: true },
        { key: "notes", label: "Notes", type: "text", long: true },
      ],
    },
  ],
  metrics: [
    { key: "scoring_cycles", label: "Scoring cycles per match", short: "Cycles", agg: { kind: "avg", field: "scoring_cycles" }, decimals: 1, higherIsBetter: true },
    { key: "teleop_fuel", label: "Teleop fuel per match", short: "Fuel", agg: { kind: "avg", field: "teleop_fuel" }, decimals: 1, higherIsBetter: true },
    { key: "auto_fuel", label: "Auto fuel per match", short: "Auto fuel", agg: { kind: "avg", field: "auto_fuel" }, decimals: 1, higherIsBetter: true },
    { key: "ferry_cycles", label: "Ferrying cycles per match", short: "Ferry", agg: { kind: "avg", field: "ferry_cycles" }, decimals: 1, higherIsBetter: true },
    { key: "auto_climb_rate", label: "Auto climb rate", short: "Auto climb", agg: { kind: "rate", field: "auto_climb", equals: true }, percent: true, higherIsBetter: true },
    { key: "climb_rate", label: "Climb success rate", short: "Climb", agg: { kind: "selectRate", field: "climb_level", values: ["l1", "l2", "l3"] }, percent: true, higherIsBetter: true },
    { key: "climb_points", label: "Teleop climb points per match", short: "Climb pts", agg: { kind: "avgPoints", field: "climb_level", points: TELEOP_CLIMB_POINTS }, decimals: 1, higherIsBetter: true },
    { key: "scoring_rating", label: "Scoring rating", short: "Scoring", agg: { kind: "ratingAvg", field: "scoring_rating" }, decimals: 1, higherIsBetter: true },
    { key: "defence_rating", label: "Defence rating", short: "Defence", agg: { kind: "ratingAvg", field: "defence_rating" }, decimals: 1, higherIsBetter: true },
  ],
  headlineMetric: "teleop_fuel",
  predictInputs(teams) {
    let fuel = 0;
    let climb = 0;
    for (const team of teams) {
      fuel += (team.auto_fuel ?? 0) + (team.teleop_fuel ?? 0);
      climb += (team.climb_points ?? 0) + (team.auto_climb_rate ?? 0) * AUTO_CLIMB_POINTS;
    }
    return { fuel, climb };
  },
  entryPoints(data) {
    const number = (key: string) => (typeof data[key] === "number" ? (data[key] as number) : 0);
    const climb = typeof data.climb_level === "string" ? (TELEOP_CLIMB_POINTS[data.climb_level] ?? 0) : 0;
    return number("auto_fuel") + number("teleop_fuel") + (data.auto_climb === true ? AUTO_CLIMB_POINTS : 0) + climb;
  },
  pitMismatches(pit, observed, matchesObserved) {
    const notes: string[] = [];
    if (matchesObserved < 2) return notes;
    const claimed = typeof pit.climb_capability === "string" ? pit.climb_capability : "none";
    if (claimed !== "none" && (observed.climb_rate ?? 0) === 0) {
      notes.push(`Says it can climb ${CLIMB_LEVELS.find((l) => l.value === claimed)?.label ?? claimed}, but has not climbed in ${matchesObserved} matches watched.`);
    }
    const perCycle = typeof pit.fuel_per_cycle === "number" ? pit.fuel_per_cycle : null;
    const perShift = typeof pit.cycles_per_shift === "number" ? pit.cycles_per_shift : null;
    const seen = observed.teleop_fuel;
    if (perCycle !== null && perShift !== null && seen !== undefined) {
      // A robot's hub is active for about three of the five teleop periods.
      const claimedFuel = perCycle * perShift * 3;
      if (claimedFuel > 20 && claimedFuel > seen * 2) {
        notes.push(`Claims about ${Math.round(claimedFuel)} fuel a match; scouts saw about ${Math.round(seen)}.`);
      }
    }
    if (pit.auto_climb === true && (observed.auto_climb_rate ?? 0) === 0) {
      notes.push(`Says it climbs in auto, but has not in ${matchesObserved} matches watched.`);
    }
    return notes;
  },
  briefContext: [
    "Game: REBUILT (FRC 2026). A match lasts 2:40: auto 20 s, transition 10 s, four 25 s shifts, end game 30 s.",
    "Robots score fuel in their alliance hub. Fuel in an active hub is 1 point; fuel in an inactive hub is 0.",
    "The alliance that wins auto makes the opponents' hub inactive in shift 1; hubs then alternate each shift, and both are active in the end game.",
    "Tower climb: auto Level 1 is 15 points (two robots at most); teleop Level 1, 2, 3 are 10, 20, 30 points.",
    "Ranking points: win 3, tie 1. Bonus points: Energized at 100 fuel, Supercharged at 360 fuel, Traversal at 50 tower points.",
    "Key rules: G418 limits a pin to 5 seconds with a 3 second back-off. G420 forbids contact with an opponent on the tower in the last 30 seconds.",
  ].join("\n"),
};
