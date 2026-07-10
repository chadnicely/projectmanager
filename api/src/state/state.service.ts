import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UserDoc } from '../auth/auth.service';
import { normEmail } from '../common/crypto';

const STATE_COLLECTION = 'appstate';
const STATE_ID = 'main';
const MEMBERSHIPS = 'memberships';
const stateIdFor = (u: UserDoc) => 'user:' + u._id;

const DEFAULT_COLS_SRV = [
  { key: 'Hold', color: '#5f6b7a' }, { key: 'URGENT', color: '#e2445c' }, { key: 'In Cue', color: '#f0a020' },
  { key: 'Completed', color: '#a23bc7' }, { key: 'Next Up', color: '#2f9be0' }, { key: 'In Progress', color: '#3b5bdb' }, { key: 'Approved', color: '#40b869' },
];

type Dict = Record<string, any>;
interface OpResult { result?: any; changed?: boolean; error?: string }

@Injectable()
export class StateService {
  constructor(private readonly database: DatabaseService) {}

  private async resolveOwner(me: UserDoc): Promise<{ ownerId: string; shared: boolean }> {
    const db = await this.database.db();
    const mem = await db.collection(MEMBERSHIPS).findOne({ _id: me._id as any });
    if (mem && mem.owner && mem.owner !== me._id) return { ownerId: mem.owner, shared: true };
    return { ownerId: me._id, shared: false };
  }

  private memberEmailsOf(state: Dict, ownerEmail: string): string[] {
    const out: string[] = [];
    const ppl: Dict[] = Array.isArray(state?.people) ? state.people : [];
    for (const p of ppl) {
      const e = normEmail(p?.email);
      if (e && e !== ownerEmail && !out.includes(e)) out.push(e);
    }
    return out;
  }

  // Granular, validated ops — mirrors the client shape; never overwrites the whole workspace.
  applyOp(state: Dict, body: Dict): OpResult {
    const op = String(body?.op || '');
    const boards: Dict[] = state.boards || (state.boards = []);
    const nid = () => { state.nextId = (state.nextId || 1000) + 1; return state.nextId; };
    const lc = (s: unknown) => String(s == null ? '' : s).trim().toLowerCase();
    const findBoard = (ref: unknown): Dict | undefined => {
      if (ref == null || ref === '') return boards[state.activeBoard || 0] || boards[0];
      if (typeof ref === 'number') return boards[ref];
      const r = lc(ref);
      return boards.find((b) => lc(b.name) === r) || boards.find((b) => lc(b.name).includes(r));
    };
    const findGroup = (bd: Dict, name: unknown): Dict | undefined => {
      const r = lc(name); const gs: Dict[] = bd.groups || [];
      return gs.find((g) => lc(g.name) === r) || gs.find((g) => lc(g.name).includes(r));
    };
    const locate = (bd: Dict, id: unknown): { it: Dict; g: Dict } | null => {
      for (const g of bd.groups || []) { const it = (g.items || []).find((x: Dict) => String(x.id) === String(id)); if (it) return { it, g }; }
      return null;
    };
    const cardView = (it: Dict) => ({ id: it.id, name: it.name, status: it.status || '', assignees: it.assignees || [], comments: (it.commentList || []).length, files: (it.fileList || []).length });
    const newItem = (name: unknown, status: unknown, assignees: unknown): Dict => ({
      id: nid(), name: String(name || '').trim() || 'Untitled', status: status || '', docs: 0, comments: 0, sub: false, person: false,
      link: '', linkText: '', created: '', createdAt: Date.now(), assignees: Array.isArray(assignees) ? assignees : [],
      labels: [], urls: [], commentList: [], fileList: [], subitemList: [], checklists: [], activityLog: [],
    });

    switch (op) {
      case 'list_boards':
        return { changed: false, result: boards.map((b, i) => ({ index: i, name: b.name, space: b.spaceId, groups: (b.groups || []).length, cards: (b.groups || []).reduce((n: number, g: Dict) => n + (g.items || []).length, 0) })) };
      case 'get_board': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        return { changed: false, result: { name: bd.name, groups: (bd.groups || []).map((g: Dict) => ({ group: g.name, cards: (g.items || []).map(cardView) })) } };
      }
      case 'create_board': {
        const name = String(body.name || '').trim(); if (!name) return { error: 'name is required' };
        const sid = state.activeSpace || (state.spaces && state.spaces[0] && state.spaces[0].id) || 'sp1';
        boards.push({ name, spaceId: sid, columns: DEFAULT_COLS_SRV.map((c) => ({ ...c })), groups: [{ id: 'g' + nid(), name: 'New Group', color: '#868e9c', collapsed: false, items: [] }] });
        return { changed: true, result: { ok: true, board: name, index: boards.length - 1 } };
      }
      case 'create_group': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        const name = String(body.name || '').trim(); if (!name) return { error: 'name is required' };
        bd.groups = bd.groups || []; bd.groups.push({ id: 'g' + nid(), name, color: '#868e9c', collapsed: false, items: [] });
        return { changed: true, result: { ok: true, board: bd.name, group: name } };
      }
      case 'add_card': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        bd.groups = bd.groups || [];
        let g = body.group ? findGroup(bd, body.group) : bd.groups[0];
        if (!g && body.group) { g = { id: 'g' + nid(), name: String(body.group), color: '#868e9c', collapsed: false, items: [] }; bd.groups.push(g); }
        if (!g) return { error: 'No group to add to (create one first)' };
        const it = newItem(body.name, body.status, body.assignees);
        if (body.note) it.description = String(body.note);
        g.items = g.items || []; g.items.push(it);
        return { changed: true, result: { ok: true, cardId: it.id, board: bd.name, group: g.name } };
      }
      case 'update_card': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
        if (body.name != null) f.it.name = String(body.name);
        if (body.status != null) f.it.status = String(body.status);
        if (body.note != null) f.it.description = String(body.note);
        if (Array.isArray(body.assignees)) f.it.assignees = body.assignees;
        return { changed: true, result: { ok: true, cardId: f.it.id } };
      }
      case 'move_card': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
        const g = findGroup(bd, body.toGroup); if (!g) return { error: 'Target group not found' };
        f.g.items = f.g.items.filter((x: Dict) => x !== f.it); g.items = g.items || []; g.items.push(f.it);
        return { changed: true, result: { ok: true, cardId: f.it.id, toGroup: g.name } };
      }
      case 'add_comment': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
        const text = String(body.text || '').trim(); if (!text) return { error: 'text is required' };
        f.it.commentList = f.it.commentList || []; f.it.commentList.push({ id: nid(), author: body.author || 'Claude', at: new Date().toISOString(), text });
        return { changed: true, result: { ok: true, cardId: f.it.id, comments: f.it.commentList.length } };
      }
      case 'delete_card': {
        const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
        const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
        f.g.items = f.g.items.filter((x: Dict) => x !== f.it);
        return { changed: true, result: { ok: true, deleted: body.cardId } };
      }
      default:
        return { error: 'Unknown op: ' + op };
    }
  }

  async getState(me: UserDoc) {
    const db = await this.database.db();
    const { ownerId, shared } = await this.resolveOwner(me);
    if (shared) {
      const sdoc = await db.collection(STATE_COLLECTION).findOne({ _id: ('user:' + ownerId) as any });
      return { state: sdoc ? sdoc.state : null, updatedAt: sdoc ? sdoc.updatedAt : null, shared: true, owner: ownerId, you: me._id, readOnly: true };
    }
    const sid = stateIdFor(me);
    let doc = await db.collection(STATE_COLLECTION).findOne({ _id: sid as any });
    if (!doc) {
      const legacy = await db.collection(STATE_COLLECTION).findOne({ _id: STATE_ID as any });
      if (legacy && legacy.updatedBy === me._id) {
        doc = { _id: sid, state: legacy.state, updatedAt: legacy.updatedAt, updatedBy: me._id } as any;
        await db.collection(STATE_COLLECTION).updateOne({ _id: sid as any }, { $set: { state: legacy.state, updatedAt: legacy.updatedAt, updatedBy: me._id } }, { upsert: true }).catch(() => {});
        await db.collection(STATE_COLLECTION).updateOne({ _id: STATE_ID as any }, { $set: { migratedTo: sid, migratedAt: new Date().toISOString() } }).catch(() => {});
      }
    }
    return { state: doc ? doc.state : null, updatedAt: doc ? doc.updatedAt : null, shared: false, owner: me._id, you: me._id };
  }

  async putState(me: UserDoc, state: Dict) {
    if (!state || typeof state !== 'object') throw new BadRequestException('Expected a state object');
    const db = await this.database.db();
    const { shared } = await this.resolveOwner(me);
    if (shared) throw new ForbiddenException('Read-only: this is a shared workspace you were invited to.');
    const updatedAt = new Date().toISOString();
    await db.collection(STATE_COLLECTION).updateOne({ _id: stateIdFor(me) as any }, { $set: { state, updatedAt, updatedBy: me._id } }, { upsert: true });
    const members = this.memberEmailsOf(state, me._id);
    const mcol = db.collection(MEMBERSHIPS);
    for (const m of members) await mcol.updateOne({ _id: m as any }, { $set: { _id: m, owner: me._id, updatedAt } }, { upsert: true }).catch(() => {});
    await mcol.deleteMany({ owner: me._id, _id: { $nin: members } as any }).catch(() => {});
    return { ok: true, updatedAt };
  }

  async op(me: UserDoc, body: Dict) {
    if (!body || typeof body !== 'object') throw new BadRequestException('Expected JSON { op, ... }');
    const db = await this.database.db();
    const { shared } = await this.resolveOwner(me);
    if (shared) throw new ForbiddenException('Read-only shared workspace — use the web app.');
    const sid = stateIdFor(me);
    const doc = await db.collection(STATE_COLLECTION).findOne({ _id: sid as any });
    const state = doc && doc.state;
    if (!state) throw new HttpException('No workspace yet — open Base once to create it.', HttpStatus.CONFLICT);
    const r = this.applyOp(state, body);
    if (r.error) throw new BadRequestException(r.error);
    if (r.changed) {
      const updatedAt = new Date().toISOString();
      await db.collection(STATE_COLLECTION).updateOne({ _id: sid as any }, { $set: { state, updatedAt, updatedBy: me._id } });
      return { ok: true, updatedAt, result: r.result };
    }
    return { ok: true, result: r.result };
  }
}
