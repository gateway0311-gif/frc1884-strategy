import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getGame, type GameDefinition } from "@shared/games/index";
import type { Role } from "@shared/roles";
import { api } from "./api";
import { connectLive, disconnectLive, onLiveChange } from "./live";
import { clearQueries, invalidate } from "./query";

export interface HubEvent {
  eventKey: string;
  name: string;
  season: number;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  gameId: string;
}

export interface SessionInfo {
  user: { name: string; role: Role } | null;
  event: HubEvent | null;
  signInReady: boolean;
}

interface SessionContextValue {
  loading: boolean;
  user: { name: string; role: Role } | null;
  event: HubEvent | null;
  game: GameDefinition;
  signInReady: boolean;
  signIn(name: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  reload(): Promise<void>;
}

const SESSION_KEY = "hub-session";

function rememberedSession(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

function forgetSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to forget.
  }
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);

  const reload = useCallback(async () => {
    try {
      const fresh = await api<SessionInfo>("/session");
      setInfo(fresh);
      try {
        if (fresh.user) localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
        else localStorage.removeItem(SESSION_KEY);
      } catch {
        // Not being able to remember the session only matters when opening the hub with no signal.
      }
    } catch {
      // No signal: carry on as whoever was last signed in on this device, so a
      // scout can open the hub in the stands and keep working.
      setInfo((previous) => previous ?? rememberedSession() ?? { user: null, event: null, signInReady: true });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const eventKey = info?.user ? info.event?.eventKey : undefined;
  useEffect(() => {
    if (!eventKey) return;
    connectLive(eventKey);
    return () => disconnectLive();
  }, [eventKey]);

  // A lead switching the active event (or its game) reaches everyone at once.
  useEffect(() => onLiveChange((change) => {
    if (change.entity === "session") void reload();
  }), [reload]);

  useEffect(() => {
    const listener = () => void reload();
    window.addEventListener("hub-signed-out", listener);
    return () => window.removeEventListener("hub-signed-out", listener);
  }, [reload]);

  const value = useMemo<SessionContextValue>(
    () => ({
      loading: info === null,
      user: info?.user ?? null,
      event: info?.event ?? null,
      game: getGame(info?.event?.gameId),
      signInReady: info?.signInReady ?? true,
      async signIn(name, code) {
        const result = await api<{ user: SessionInfo["user"]; event: HubEvent | null }>("/session", {
          method: "POST",
          body: { name, code },
        });
        clearQueries();
        const next = { user: result.user, event: result.event, signInReady: true };
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        } catch {
          // See above.
        }
        setInfo(next);
      },
      async signOut() {
        await api("/session", { method: "DELETE" }).catch(() => undefined);
        disconnectLive();
        clearQueries();
        forgetSession();
        setInfo({ user: null, event: null, signInReady: true });
      },
      reload: async () => {
        await reload();
        invalidate();
      },
    }),
    [info, reload]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
