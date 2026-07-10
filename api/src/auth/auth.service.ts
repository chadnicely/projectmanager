import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { hashPassword, verifyPassword, newToken, normEmail } from '../common/crypto';

const USERS = 'users';
const SESSIONS = 'sessions';
const APITOKENS = 'apitokens';
const SESSION_DAYS = 30;

export interface UserDoc {
  _id: string;
  name?: string;
  salt?: string;
  hash?: string;
  sobStatus?: string;
  _authVia?: 'session' | 'apitoken';
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  publicUser(u: UserDoc) {
    return { email: u._id, name: u.name || u._id };
  }

  private async startSession(email: string): Promise<string> {
    const db = await this.database.db();
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    await db.collection(SESSIONS).insertOne({ _id: token as unknown as never, email, createdAt: new Date().toISOString(), expiresAt });
    return token;
  }

  async signup(email: string, password: string, name?: string) {
    const e = normEmail(email);
    const pw = String(password || '');
    if (!e || !pw) throw new BadRequestException('Email and password required');
    if (pw.length < 6) throw new BadRequestException('Password must be at least 6 characters');
    const db = await this.database.db();
    const exists = await db.collection(USERS).findOne({ _id: e as unknown as never });
    if (exists) throw new ConflictException('An account with that email already exists');
    const { salt, hash } = hashPassword(pw);
    const nm = (name || '').trim() || e;
    await db.collection(USERS).insertOne({ _id: e as unknown as never, name: nm, salt, hash, createdAt: new Date().toISOString() });
    const token = await this.startSession(e);
    return { token, user: { email: e, name: nm } };
  }

  async login(email: string, password: string) {
    const e = normEmail(email);
    const db = await this.database.db();
    const u = (await db.collection(USERS).findOne({ _id: e as unknown as never })) as UserDoc | null;
    if (!u || !u.salt || !u.hash) throw new UnauthorizedException('No password is set for this account yet.');
    if (!verifyPassword(String(password || ''), u.salt, u.hash)) throw new UnauthorizedException('Wrong email or password');
    if (u.sobStatus && String(u.sobStatus).toLowerCase() !== 'active') {
      throw new UnauthorizedException(`Your account is ${u.sobStatus}.`);
    }
    const token = await this.startSession(e);
    return { token, user: this.publicUser(u) };
  }

  async logout(token: string) {
    if (token) {
      const db = await this.database.db();
      await db.collection(SESSIONS).deleteOne({ _id: token as unknown as never });
    }
    return { ok: true };
  }

  // Resolve a bearer token (web session OR personal API token) → user doc, or null.
  async userFromToken(token: string): Promise<UserDoc | null> {
    if (!token) return null;
    const db = await this.database.db();
    const sess = await db.collection(SESSIONS).findOne({ _id: token as unknown as never });
    if (sess) {
      if (sess.expiresAt && new Date(sess.expiresAt) < new Date()) {
        await db.collection(SESSIONS).deleteOne({ _id: token as unknown as never }).catch(() => {});
        return null;
      }
      const u = (await db.collection(USERS).findOne({ _id: sess.email as unknown as never })) as UserDoc | null;
      if (u) u._authVia = 'session';
      return u;
    }
    const apt = await db.collection(APITOKENS).findOne({ secret: token });
    if (apt) {
      db.collection(APITOKENS).updateOne({ _id: apt._id }, { $set: { lastUsedAt: new Date().toISOString() } }).catch(() => {});
      const u = (await db.collection(USERS).findOne({ _id: apt.email as unknown as never })) as UserDoc | null;
      if (u) u._authVia = 'apitoken';
      return u;
    }
    return null;
  }
}
