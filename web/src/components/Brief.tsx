import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatAgo, useNow } from "../lib/data";
import { useQuery } from "../lib/query";
import { useSession } from "../lib/session";
import { Icon } from "./Icon";
import { describeError, Notice, Panel } from "./ui";

interface BriefStatus {
  kind: string;
  subject: string;
  staleness: "fresh" | "stale" | "missing";
  content: string | null;
  generatedAt: string | null;
  model: string | null;
  configured: boolean;
}

function inline(text: string): ReactNode[] {
  // Only bold is supported; everything else is shown as plain text.
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

// A small, safe renderer for the headings and bullets the briefs are written in.
export function BriefText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,4}\s/.test(line)) {
      flush();
      blocks.push(<h3 key={`h${blocks.length}`}>{line.replace(/^#{1,4}\s+/, "")}</h3>);
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else {
      flush();
      blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="brief-text">{blocks}</div>;
}

export function Brief({ kind, subject, title }: { kind: "match" | "team" | "event"; subject: string; title: string }) {
  const { event } = useSession();
  const now = useNow();
  const path = `/events/${event!.eventKey}/briefs/${kind}/${subject}`;
  const status = useQuery<BriefStatus>(`brief:${event!.eventKey}:${kind}:${subject}`, () => api(path), ["brief", "compiled", "pit"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef<string | null>(null);

  async function write(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body: { force } });
      status.refresh();
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      setError(code === "brief_failed" ? "The AI service did not answer. Try again in a minute." : describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const data = status.data;
  // Write the brief once when it is opened and is missing or out of date.
  useEffect(() => {
    if (!data || !data.configured || data.staleness === "fresh") return;
    const marker = `${subject}:${data.generatedAt ?? "none"}`;
    if (asked.current === marker) return;
    asked.current = marker;
    void write(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.staleness, data?.configured, data?.generatedAt, subject]);

  return (
    <Panel
      title={
        <span className="brief-title">
          <Icon name="spark" size={18} /> {title}
        </span>
      }
      aside={
        data?.content ? (
          <span>
            Written by AI {formatAgo(data.generatedAt, now)}
            {busy ? ", updating…" : data.staleness === "stale" ? ", new data since" : ""}
          </span>
        ) : undefined
      }
    >
      {status.loading ? <p className="dim">Loading…</p> : null}
      {data && !data.configured && !data.content ? (
        <p className="dim">AI briefs are switched off because the AI key is not set on the server. Everything else on this page still works.</p>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data?.content ? <BriefText text={data.content} /> : busy ? <p className="dim">Writing the brief. This takes a few seconds.</p> : null}
      {data?.configured ? (
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void write(true)}>
            {busy ? "Writing…" : data.content ? "Write it again" : "Write the brief"}
          </button>
          <span className="dim brief-caveat">AI can be wrong. Check it against the figures.</span>
        </div>
      ) : null}
    </Panel>
  );
}
