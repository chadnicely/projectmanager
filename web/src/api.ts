// Typed client for the existing Base backend (same endpoints the old app used).
import type { User, WorkspaceState } from "./types";

const TOKEN_KEY = "pc-token";
export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function req<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth) { const t = getToken(); if (t) headers["Authorization"] = "Bearer " + t; }
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && typeof data === "object" && "error" in data) ? String((data as { error: unknown }).error) : res.statusText;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface StateResponse {
  state: WorkspaceState | null;
  updatedAt: string | null;
  shared?: boolean;
  owner?: string;
  you?: string;
  readOnly?: boolean;
}

export const api = {
  health: () => req<{ ok: boolean; db: string }>("/api/health"),
  signup: (email: string, password: string, name?: string) =>
    req<{ token: string; user: User }>("/api/signup", { method: "POST", body: { email, password, name } }),
  login: (email: string, password: string) =>
    req<{ token: string; user: User }>("/api/login", { method: "POST", body: { email, password } }),
  logout: () => req<{ ok: boolean }>("/api/logout", { method: "POST", auth: true }),
  me: () => req<{ user: User }>("/api/me", { auth: true }),
  getState: () => req<StateResponse>("/api/state", { auth: true }),
  putState: (state: WorkspaceState) => req<{ ok: boolean; updatedAt: string }>("/api/state", { method: "PUT", body: state, auth: true }),
  op: (op: string, args: Record<string, unknown> = {}) =>
    req<{ ok: boolean; result?: unknown }>("/api/op", { method: "POST", body: { op, ...args }, auth: true }),
};
