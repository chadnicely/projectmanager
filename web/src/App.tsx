import { useState } from "react";
import { useWorkspace } from "./store";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { BoardView } from "./components/BoardView";
import type { AppName } from "./types";

export function App() {
  const { user, state, booting } = useWorkspace();
  const [app, setApp] = useState<AppName>("boards");

  if (booting) return <div className="boot">Loading…</div>;
  if (!user) return <AuthScreen />;

  return (
    <div className="app">
      <Topbar app={app} onApp={setApp} />
      <div className="body">
        <Sidebar />
        <main className="main">
          {!state ? (
            <div className="empty">No workspace yet.</div>
          ) : app === "boards" ? (
            <BoardView />
          ) : (
            <div className="empty">
              <h2>{app[0].toUpperCase() + app.slice(1)}</h2>
              <p>This screen is being ported to the new stack next.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
