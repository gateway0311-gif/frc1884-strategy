import { useEffect } from "react";
import { startOutbox } from "./lib/outbox";
import { can, ROLE_LABELS } from "@shared/roles";
import { Icon } from "./components/Icon";
import { Empty, Link, Loading, Page } from "./components/ui";
import { useLiveState } from "./lib/live";
import { navigate, segments, usePath } from "./lib/router";
import { useSession } from "./lib/session";
import { homeFor, NAV, navFor } from "./nav";
import { AdminPage } from "./pages/Admin";
import { ManagerPage } from "./pages/Manager";
import { MorePage } from "./pages/More";
import { PitEntry, PitList } from "./pages/Pit";
import { ScoutEntry, ScoutHome, ScoutPick } from "./pages/Scout";
import { SignIn } from "./pages/SignIn";
import { StrategyPage } from "./pages/Strategy";

function LiveBadge() {
  const state = useLiveState();
  const label = state === "live" ? "Live" : state === "offline" ? "Offline" : "Connecting";
  return (
    <span className={`live live-${state}`} title={state === "offline" ? "Changes are saved on this device and sent when the connection returns." : undefined}>
      <span className="live-dot" />
      {label}
    </span>
  );
}

function Routes({ path }: { path: string }) {
  const { user } = useSession();
  const [section, ...rest] = segments(path);
  const role = user!.role;
  const item = NAV.find((n) => n.id === section);

  if (item && !can(role, item.permission)) {
    return (
      <Page title="Not available">
        <Empty title="Your sign-in code does not open this page.">Ask a lead for the right code if you need it.</Empty>
      </Page>
    );
  }

  switch (section) {
    case "scout":
      if (rest[0] === "entry" && rest[1]) return <ScoutEntry id={rest[1]} />;
      if (rest[0] === "pick") return <ScoutPick />;
      if (rest[0] === "pit") return rest[1] ? <PitEntry key={rest[1]} teamNumber={Number(rest[1])} /> : <PitList />;
      return <ScoutHome />;
    case "strategy":
      return <StrategyPage rest={rest} />;
    case "manager":
      return <ManagerPage rest={rest} />;
    case "admin":
      return <AdminPage />;
    case "more":
      return <MorePage rest={rest} />;
    default:
      return (
        <Page title={item?.label ?? "Not found"}>
          <Empty title={item ? "This page is being built." : "There is nothing at this address."} />
        </Page>
      );
  }
}

export function App() {
  const { loading, user, event, signOut } = useSession();
  const path = usePath();

  useEffect(() => {
    if (user && path === "/") navigate(homeFor(user.role), { replace: true });
  }, [user, path]);

  const signedIn = !!user;
  useEffect(() => (signedIn ? startOutbox() : undefined), [signedIn]);

  if (loading) {
    return (
      <div className="boot">
        <Loading label="Opening the hub" />
      </div>
    );
  }
  if (!user) return <SignIn />;

  const items = navFor(user.role);
  const active = segments(path)[0];

  return (
    <div className="shell">
      <header className="topbar">
        <Link to={homeFor(user.role)} className="brand">
          <img src="/assets/griffins-mark.png" alt="" width={28} height={28} />
          <span className="brand-name">Griffins Hub</span>
        </Link>
        <div className="topbar-event">{event ? event.name : "No event set up"}</div>
        <div className="topbar-right">
          <LiveBadge />
          <span className="who">
            {user.name}
            <span className="who-role">{ROLE_LABELS[user.role]}</span>
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Sections">
        {items.map((item) => (
          <Link key={item.id} to={item.to} className={`nav-item${active === item.id ? " is-active" : ""}`}>
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="content">
        <Routes path={path} />
      </div>
    </div>
  );
}
