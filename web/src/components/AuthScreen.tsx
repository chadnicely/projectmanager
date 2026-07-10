import { useState } from "react";
import { useWorkspace } from "../store";

export function AuthScreen() {
  const { signIn } = useWorkspace();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setErr("Enter your email and password."); return; }
    setBusy(true); setErr("");
    try { await signIn(mode, email.trim(), password, name.trim()); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Something went wrong."); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="mark">B</span> Base</div>
        <h1>{mode === "signup" ? "Create your account" : "Sign in to Base"}</h1>
        {err && <div className="auth-err">{err}</div>}
        {mode === "signup" && (
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
        )}
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        <button type="submit" disabled={busy}>{busy ? "…" : mode === "signup" ? "Create account" : "Log in"}</button>
        <p className="auth-switch">
          {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
          <a onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setErr(""); }}>
            {mode === "signup" ? "Log in" : "Create an account"}
          </a>
        </p>
      </form>
    </div>
  );
}
