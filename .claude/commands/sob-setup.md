---
description: Integrate this project with SOB (SaaSOnboard) — installs the SDK, wires signup/login, adds the webhook endpoints, and hands you the SOB dashboard config. Runs as a conversational wizard.
---

Run the **`sob-integration`** skill to integrate this project with the SOB (SaaSOnboard) platform, end to end.

Do it as a friendly, step-by-step wizard — talk to me like a normal conversation, explain what each step does,
and ask me for anything you need (one thing at a time, not a wall of questions). Specifically:

1. First look at this app's auth — find the signup/login handlers and the users store — and confirm the shape.
2. Ask me for the SOB bootstrap config (the `{slug, base_url, token}` file — I'll point you at it or paste it),
   save it as a git-ignored `connect-bootstrap.json`, and verify the token by reading my workspace's access
   levels + user types back to me.
3. Install `sob-connect-sdk`, add the integration module (`sob.js`), and wire it into signup + login
   (mirror users up to SOB, gate login on SOB status, record logins).
4. Add the `/api/sob/<event>` webhook endpoints, generate a webhook secret, and set up the deploy env vars
   (hand me the secret ones I need to set myself).
5. Give me the exact **SOB dashboard configuration** to paste in — the connection (base URL + Bearer secret)
   and the 5 per-event endpoints with their body templates, using SOB's real template variables.
6. Explain the password situation (SOB doesn't send passwords → default-password fallback) and confirm the
   default with me.
7. Test the whole thing with curl and clean up any throwaway test users.

Be thorough. If this project isn't a custom Node app with its own auth, tell me and adapt the approach.
