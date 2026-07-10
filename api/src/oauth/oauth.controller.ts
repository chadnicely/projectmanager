import { Body, Controller, Get, Header, HttpCode, HttpException, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';
import { newToken, normEmail, verifyPassword } from '../common/crypto';

const OAUTH_CLIENTS = 'oauth_clients';
const OAUTH_CODES = 'oauth_codes';
const APITOKENS = 'apitokens';
const USERS = 'users';

const baseUrl = (req: Request) => ((req.headers['x-forwarded-proto'] as string) || 'https').split(',')[0] + '://' + req.headers.host;
const escHtml = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function authorizeForm(p: Record<string, any>, error: string): string {
  const hidden = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'response_type']
    .map((k) => `<input type="hidden" name="${k}" value="${escHtml(p[k] || '')}">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Claude · Base</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c1312;color:#e7efed;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.card{width:min(400px,92vw);background:#121b1a;border:1px solid #213230;border-radius:16px;padding:30px 28px}
.mark{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:20px;background:linear-gradient(135deg,#12c2ae,#0e9e90);margin-bottom:16px}
h1{font-size:20px;margin:0 0 6px}p.sub{margin:0 0 20px;color:#93a5a1;font-size:14px}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#93a5a1;margin:14px 0 5px}
input[type=email],input[type=password]{width:100%;padding:11px 12px;border-radius:9px;border:1px solid #2b3d3a;background:#0c1312;color:#e7efed;font-size:15px;box-sizing:border-box}
input:focus{outline:none;border-color:#2dd4bf}button{width:100%;margin-top:22px;padding:12px;border:none;border-radius:9px;background:#0e9e90;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
.err{background:rgba(226,68,92,.15);border:1px solid rgba(226,68,92,.5);color:#ff9db0;padding:9px 12px;border-radius:9px;font-size:13.5px;margin-bottom:14px}.note{margin-top:18px;color:#7c8d89;font-size:12.5px;text-align:center}
</style></head><body><form class="card" method="post" action="/authorize">
<div class="mark">B</div><h1>Authorize Claude</h1><p class="sub">Sign in to Base to let Claude access your workspace.</p>
${error ? `<div class="err">${escHtml(error)}</div>` : ''}
<label>Email</label><input type="email" name="email" autocomplete="username" required autofocus>
<label>Password</label><input type="password" name="password" autocomplete="current-password" required>
${hidden}<button type="submit">Sign in &amp; authorize</button>
<div class="note">Claude will be able to read and edit your boards. Revoke anytime in Base.</div></form></body></html>`;
}

// OAuth 2.1 authorization server for the MCP remote-auth flow.
@Controller()
export class OAuthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('.well-known/oauth-authorization-server')
  asMetadata(@Req() req: Request) {
    const o = baseUrl(req);
    return {
      issuer: o, authorization_endpoint: o + '/authorize', token_endpoint: o + '/token', registration_endpoint: o + '/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['base'],
    };
  }

  @Get('.well-known/oauth-protected-resource')
  prMetadata(@Req() req: Request) {
    const o = baseUrl(req);
    return { resource: o + '/mcp', authorization_servers: [o] };
  }

  @Post('register')
  @HttpCode(201)
  async register(@Body() body: { redirect_uris?: string[]; client_name?: string }) {
    const db = await this.database.db();
    const redirect_uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
    const client_id = 'client_' + newToken().slice(0, 24);
    await db.collection(OAUTH_CLIENTS).insertOne({ _id: client_id as any, redirect_uris, name: body?.client_name || '', createdAt: new Date().toISOString() });
    return { client_id, redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
  }

  @Get('authorize')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async authorizePage(@Query() q: Record<string, string>, @Res({ passthrough: true }) res: Response) {
    const db = await this.database.db();
    const client = await db.collection(OAUTH_CLIENTS).findOne({ _id: q.client_id as any });
    if (!client) { res.status(400); return '<p>Unknown or missing client_id.</p>'; }
    if (!q.redirect_uri || (client.redirect_uris.length && !client.redirect_uris.includes(q.redirect_uri))) { res.status(400); return '<p>Invalid redirect_uri.</p>'; }
    return authorizeForm(q, '');
  }

  @Post('authorize')
  async authorizeSubmit(@Body() form: Record<string, string>, @Res() res: Response) {
    const db = await this.database.db();
    const client = await db.collection(OAUTH_CLIENTS).findOne({ _id: form.client_id as any });
    if (!client) { res.status(400).type('html').send('<p>Unknown client.</p>'); return; }
    if (client.redirect_uris.length && !client.redirect_uris.includes(form.redirect_uri)) { res.status(400).type('html').send('<p>Invalid redirect_uri.</p>'); return; }
    const email = normEmail(form.email);
    const u = await db.collection(USERS).findOne({ _id: email as any });
    if (!u || !u.salt || !u.hash || !verifyPassword(String(form.password || ''), u.salt, u.hash)) {
      res.status(200).type('html').send(authorizeForm(form, 'Wrong email or password.')); return;
    }
    const code = newToken();
    await db.collection(OAUTH_CODES).insertOne({
      _id: code as any, client_id: form.client_id, redirect_uri: form.redirect_uri, email,
      code_challenge: form.code_challenge || '', code_challenge_method: form.code_challenge_method || 'plain',
      scope: form.scope || 'base', expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
    const sep = form.redirect_uri.includes('?') ? '&' : '?';
    res.redirect(302, form.redirect_uri + sep + 'code=' + encodeURIComponent(code) + (form.state ? '&state=' + encodeURIComponent(form.state) : ''));
  }

  @Post('token')
  async token(@Body() form: Record<string, string>) {
    const db = await this.database.db();
    if (form.grant_type === 'authorization_code') {
      const rec = await db.collection(OAUTH_CODES).findOne({ _id: (form.code || '') as any });
      if (!rec) throw new HttpException({ error: 'invalid_grant' }, 400);
      await db.collection(OAUTH_CODES).deleteOne({ _id: rec._id });
      if (rec.expiresAt && new Date(rec.expiresAt) < new Date()) throw new HttpException({ error: 'invalid_grant', error_description: 'code expired' }, 400);
      if (rec.redirect_uri !== form.redirect_uri) throw new HttpException({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
      if (rec.code_challenge) {
        const ver = String(form.code_verifier || '');
        const got = rec.code_challenge_method === 'S256' ? crypto.createHash('sha256').update(ver).digest('base64url') : ver;
        if (got !== rec.code_challenge) throw new HttpException({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      }
      const access = newToken() + newToken(), refresh = newToken() + newToken();
      await db.collection(APITOKENS).insertOne({ _id: newToken().slice(0, 16) as any, secret: access, refresh, email: rec.email, name: 'Claude (OAuth)', via: 'oauth', scope: rec.scope, createdAt: new Date().toISOString(), lastUsedAt: null });
      return { access_token: access, token_type: 'Bearer', refresh_token: refresh, scope: rec.scope || 'base' };
    }
    if (form.grant_type === 'refresh_token') {
      const rec = await db.collection(APITOKENS).findOne({ refresh: form.refresh_token || '' });
      if (!rec) throw new HttpException({ error: 'invalid_grant' }, 400);
      const access = newToken() + newToken();
      await db.collection(APITOKENS).updateOne({ _id: rec._id }, { $set: { secret: access, lastUsedAt: new Date().toISOString() } });
      return { access_token: access, token_type: 'Bearer', refresh_token: form.refresh_token, scope: rec.scope || 'base' };
    }
    throw new HttpException({ error: 'unsupported_grant_type' }, 400);
  }
}
