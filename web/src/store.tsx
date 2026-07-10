// Workspace store: holds auth + the loaded WorkspaceState, and persists edits to the backend
// (debounced, owner-only — mirrors the old app's sync + read-only rules).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, getToken, setToken, clearToken } from "./api";
import type { User, WorkspaceState } from "./types";

type Sync = "idle" | "pending" | "ok" | "err";

interface Ctx {
  user: User | null;
  state: WorkspaceState | null;
  readOnly: boolean;
  owner: string | null;
  sync: Sync;
  booting: boolean;
  signIn: (mode: "login" | "signup", email: string, password: string, name?: string) => Promise<void>;
  signOut: () => void;
  update: (fn: (draft: WorkspaceState) => void) => void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);
export const useWorkspace = () => {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("useWorkspace must be used within <WorkspaceProvider>");
  return c;
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [sync, setSync] = useState<Sync>("idle");
  const [booting, setBooting] = useState(true);
  const pushT = useRef<number | null>(null);

  const loadState = useCallback(async () => {
    const r = await api.getState();
    setReadOnly(!!r.readOnly);
    setOwner(r.owner || null);
    setState(r.state);
  }, []);

  // On mount, resume a saved session.
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { const { user } = await api.me(); setUser(user); await loadState(); } catch { clearToken(); }
      }
      setBooting(false);
    })();
  }, [loadState]);

  const signIn: Ctx["signIn"] = async (mode, email, password, name) => {
    const r = mode === "signup" ? await api.signup(email, password, name) : await api.login(email, password);
    setToken(r.token); setUser(r.user);
    await loadState();
  };

  const signOut = () => {
    api.logout().catch(() => {});
    clearToken(); setUser(null); setState(null); setReadOnly(false); setOwner(null); setSync("idle");
  };

  // Debounced persist (owner only).
  const scheduleSave = useCallback((next: WorkspaceState) => {
    if (readOnly) return;
    setSync("pending");
    if (pushT.current) window.clearTimeout(pushT.current);
    pushT.current = window.setTimeout(() => {
      api.putState(next).then(() => setSync("ok")).catch(() => setSync("err"));
    }, 500);
  }, [readOnly]);

  const update: Ctx["update"] = (fn) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as WorkspaceState;
      fn(next);
      scheduleSave(next);
      return next;
    });
  };

  return (
    <WorkspaceCtx.Provider value={{ user, state, readOnly, owner, sync, booting, signIn, signOut, update }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
