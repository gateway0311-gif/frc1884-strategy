import { useEffect, useMemo, useState } from "react";
import { matchClock, type MatchClock, type ScheduleMatch } from "@shared/schedule";
import { api } from "./api";
import { useQuery } from "./query";
import { useSession } from "./session";

export interface ScheduleResponse {
  eventKey: string;
  ourTeam: number;
  serverTime: string;
  matches: ScheduleMatch[];
}

// Phones often have a clock that is a little off. The server's time is used
// as the reference so every scout agrees on which match is next.
let clockOffsetMs = 0;

export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function useSchedule() {
  const { event } = useSession();
  const key = event ? `schedule:${event.eventKey}` : null;
  return useQuery<ScheduleResponse>(
    key,
    async () => {
      const sent = Date.now();
      const result = await api<ScheduleResponse>(`/events/${event!.eventKey}/schedule`);
      const received = Date.now();
      clockOffsetMs = Date.parse(result.serverTime) - (sent + received) / 2;
      return result;
    },
    ["schedule"],
    { persist: true }
  );
}

export function useMatchClock(matches: ScheduleMatch[] | undefined, now: number): MatchClock | null {
  const { game } = useSession();
  return useMemo(() => (matches ? matchClock(matches, now, game.matchSeconds) : null), [matches, now, game.matchSeconds]);
}

export interface EventTeam {
  teamNumber: number;
  name: string;
  location: string | null;
}

export function useTeams() {
  const { event } = useSession();
  return useQuery<{ teams: EventTeam[] }>(event ? `teams:${event.eventKey}` : null, () => api(`/events/${event!.eventKey}/teams`), ["teams"], { persist: true });
}

export function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "No time yet";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export function formatCountdown(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total <= 0) return "now";
  const minutes = Math.floor(total / 60);
  if (minutes >= 90) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  if (minutes >= 1) return `${minutes} min`;
  return `${total} s`;
}

export function formatAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}
