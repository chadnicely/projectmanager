import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, UserDoc } from '../auth/auth.service';
import { StateService } from '../state/state.service';
import { DatabaseService } from '../database/database.service';
import { bearer } from '../common/crypto';

const baseUrl = (req: Request) => ((req.headers['x-forwarded-proto'] as string) || 'https').split(',')[0] + '://' + req.headers.host;

const MCP_TOOLS = [
  { name: 'base_health', description: 'Check Base API + database connectivity.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'base_get_state', description: 'Full workspace snapshot (boards, base tables, people, teams).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'base_list_boards', description: 'List boards with card counts.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'base_get_board', description: "Read a board's groups and cards (card ids included).", inputSchema: { type: 'object', properties: { board: { type: 'string' } }, required: ['board'] } },
  { name: 'base_create_board', description: 'Create a new board.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'base_create_group', description: 'Add a group (column) to a board.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, name: { type: 'string' } }, required: ['board', 'name'] } },
  { name: 'base_add_card', description: 'Add a card to a board group.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, group: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' }, assignees: { type: 'array', items: { type: 'string' } } }, required: ['board', 'name'] } },
  { name: 'base_update_card', description: "Update a card's name/status/note/assignees.", inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {}, name: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' }, assignees: { type: 'array', items: { type: 'string' } } }, required: ['board', 'cardId'] } },
  { name: 'base_move_card', description: 'Move a card to another group.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {}, toGroup: { type: 'string' } }, required: ['board', 'cardId', 'toGroup'] } },
  { name: 'base_add_comment', description: 'Add a comment to a card.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {}, text: { type: 'string' }, author: { type: 'string' } }, required: ['board', 'cardId', 'text'] } },
  { name: 'base_delete_card', description: 'Delete a card.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {} }, required: ['board', 'cardId'] } },
];

type Json = Record<string, any>;

// Hosted MCP endpoint (Streamable HTTP, JSON responses). Auth via a Base bearer token.
@Controller('mcp')
export class McpController {
  constructor(
    private readonly auth: AuthService,
    private readonly state: StateService,
    private readonly database: DatabaseService,
  ) {}

  private async callTool(me: UserDoc, name: string, args: Json) {
    if (name === 'base_health') {
      const db = await this.database.db();
      await db.command({ ping: 1 });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, db: db.databaseName }) }] };
    }
    if (name === 'base_get_state') {
      const r = await this.state.getState(me);
      return { content: [{ type: 'text', text: JSON.stringify(r.state) }] };
    }
    try {
      const r = await this.state.op(me, { op: name.replace(/^base_/, ''), ...args });
      const payload = (r as Json).result !== undefined ? (r as Json).result : r;
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
    }
  }

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const me = await this.auth.userFromToken(bearer(req.headers['authorization']));
    if (!me) {
      res.status(401)
        .set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`)
        .json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized — connect your Base account.' } });
      return;
    }
    const msg = req.body;
    const handleOne = async (m: Json): Promise<Json | null> => {
      const id = m && m.id !== undefined ? m.id : null;
      const isNotif = !m || m.id === undefined || m.id === null;
      const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
      const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
      try {
        switch (m && m.method) {
          case 'initialize':
            return reply({ protocolVersion: (m.params && m.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'base-mcp', version: '1.0.0' } });
          case 'ping':
            return reply({});
          case 'tools/list':
            return reply({ tools: MCP_TOOLS });
          case 'tools/call': {
            const nm = m.params && m.params.name;
            if (!MCP_TOOLS.find((t) => t.name === nm)) return err(-32601, 'Unknown tool: ' + nm);
            return reply(await this.callTool(me, nm, (m.params && m.params.arguments) || {}));
          }
          default:
            return isNotif ? null : err(-32601, 'Method not found: ' + (m && m.method));
        }
      } catch (e) {
        return err(-32603, (e as Error).message);
      }
    };

    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(handleOne))).filter(Boolean);
      if (!out.length) { res.status(202).end(); return; }
      res.json(out); return;
    }
    const out = await handleOne(msg);
    if (!out) { res.status(202).end(); return; }
    res.json(out);
  }
}
