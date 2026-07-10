import { ref, toRaw } from "vue";
import { api, getToken, setToken, clearToken } from "~/lib/api";
import type { User, WorkspaceState } from "~/types";

// Shared singleton store (SPA mode).
const user = ref<User | null>(null);
const workspace = ref<WorkspaceState | null>(null);
const readOnly = ref(false);
const owner = ref<string | null>(null);
const sync = ref<"idle" | "pending" | "ok" | "err">("idle");
const booting = ref(true);
let pushT: ReturnType<typeof setTimeout> | null = null;

async function loadState() {
  const r = await api.getState();
  readOnly.value = !!r.readOnly;
  owner.value = r.owner || null;
  workspace.value = r.state;
}

function scheduleSave(next: WorkspaceState) {
  if (readOnly.value) return;
  sync.value = "pending";
  if (pushT) clearTimeout(pushT);
  pushT = setTimeout(() => {
    api.putState(next).then(() => (sync.value = "ok")).catch(() => (sync.value = "err"));
  }, 500);
}

export function useWorkspace() {
  async function boot() {
    if (getToken()) {
      try { const { user: u } = await api.me(); user.value = u; await loadState(); } catch { clearToken(); }
    }
    booting.value = false;
  }

  async function signIn(mode: "login" | "signup", email: string, password: string, name?: string) {
    const r = mode === "signup" ? await api.signup(email, password, name) : await api.login(email, password);
    setToken(r.token); user.value = r.user; await loadState();
  }

  function signOut() {
    api.logout().catch(() => {});
    clearToken(); user.value = null; workspace.value = null; readOnly.value = false; owner.value = null; sync.value = "idle";
  }

  function update(fn: (draft: WorkspaceState) => void) {
    if (!workspace.value) return;
    const next = structuredClone(toRaw(workspace.value)) as WorkspaceState;
    fn(next);
    workspace.value = next;
    scheduleSave(next);
  }

  return { user, workspace, readOnly, owner, sync, booting, boot, signIn, signOut, update };
}
