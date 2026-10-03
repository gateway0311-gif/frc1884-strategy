import type { ComponentType } from "react";
import { rebuilt2026Field } from "./rebuilt2026";

// The field drawing for each game. A new season adds its drawing here, next
// to its definition in src/shared/games.

export interface Point {
  x: number;
  y: number;
}

export interface PlanMatch {
  red: number[];
  blue: number[];
}

export interface FieldDefinition {
  width: number;
  height: number;
  Background: ComponentType;
  defaultPositions(match: PlanMatch): Record<number, Point>;
  legend?: string;
}

// Used when a game has no drawing yet: a plain field with a centre line.
const plainField: FieldDefinition = {
  width: 720,
  height: 351,
  Background: () => (
    <>
      <rect x={0} y={0} width={720} height={351} fill="#eef2ee" stroke="#444" strokeWidth={3} />
      <line x1={360} y1={0} x2={360} y2={351} stroke="#666" strokeDasharray="8,5" />
    </>
  ),
  defaultPositions(match) {
    const positions: Record<number, Point> = {};
    match.red.forEach((team, i) => (positions[team] = { x: 120, y: 60 + i * 115 }));
    match.blue.forEach((team, i) => (positions[team] = { x: 600, y: 60 + i * 115 }));
    return positions;
  },
};

const FIELDS: Record<string, FieldDefinition> = {
  rebuilt2026: rebuilt2026Field,
};

export function getField(gameId: string): FieldDefinition {
  return FIELDS[gameId] ?? plainField;
}
