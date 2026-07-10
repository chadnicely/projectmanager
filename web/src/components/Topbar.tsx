import { useWorkspace } from "../store";
import type { AppName } from "../types";

const APPS: Record<AppName, { name: string; icon: string; grad: string }> = {
  boards: { name: "Boards", icon: "◫", grad: "linear-gradient(135deg,#12c2ae,#0e9e90)" },
  base: { name: "Base", icon: "▦", grad: "linear-gradient(135deg,#f0a020,#e2445c)" },
  time: { name: "Time", icon: "◷", grad: "linear-gradient(135deg,#3b5bdb,#2f9be0)" },
  team: { name: "Team", icon: "👥", grad: "linear-gradient(135deg,#a23bc7,#7048e8)" },
};

export function Topbar({ app, onApp }: { app: AppName; onApp: (a: AppName) => void }) {
  const { state, user, readOnly, signOut } = useWorkspace();
  const a = APPS[app];
  const space = state?.spaces.find((s) => s.id === state.activeSpace);

  return (
    <header className="topbar">
      <div className="app-switcher">
        {(Object.keys(APPS) as AppName[]).map((k) => (
          <button key={k} className={"app-tile" + (k === app ? " active" : "")} title={APPS[k].name}
            onClick={() => onApp(k)} style={{ background: APPS[k].grad }}>
            {APPS[k].icon}
          </button>
        ))}
      </div>
      <div className="logo"><span className="mark" style={{ background: a.grad }}>{a.icon}</span><b>{a.name}</b></div>
      <span className="workspace">{space?.name || "My Workspace"}</span>
      {readOnly && <span className="ro-pill">Read-only</span>}
      <div className="spacer" />
      <button className="avatar" title={user?.name} onClick={signOut}>🧔</button>
    </header>
  );
}
