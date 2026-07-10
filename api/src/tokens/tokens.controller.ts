import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserDoc } from '../auth/auth.service';
import { DatabaseService } from '../database/database.service';
import { newToken } from '../common/crypto';

const APITOKENS = 'apitokens';

// Personal API tokens for the MCP / integrations. Managed only from a real web session.
@Controller('api/tokens')
@UseGuards(AuthGuard)
export class TokensController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async list(@CurrentUser() me: UserDoc) {
    const db = await this.database.db();
    const rows = await db.collection(APITOKENS).find({ email: me._id }).toArray();
    return {
      tokens: rows.map((t) => ({ id: t._id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || null, preview: String(t.secret || '').slice(0, 10) + '…' })),
    };
  }

  @Post()
  async create(@CurrentUser() me: UserDoc, @Body() b: { name?: string }) {
    if (me._authVia !== 'session') throw new ForbiddenException('Create API tokens from the web app while signed in.');
    const db = await this.database.db();
    const name = (String(b?.name || '').trim() || 'Claude Code').slice(0, 60);
    const secret = 'bmk_' + newToken() + newToken();
    const id = newToken().slice(0, 16);
    await db.collection(APITOKENS).insertOne({ _id: id as any, secret, email: me._id, name, createdAt: new Date().toISOString(), lastUsedAt: null });
    return { id, name, token: secret };
  }

  @Delete(':id')
  async revoke(@CurrentUser() me: UserDoc, @Param('id') id: string) {
    if (me._authVia !== 'session') throw new ForbiddenException('Revoke API tokens from the web app while signed in.');
    const db = await this.database.db();
    await db.collection(APITOKENS).deleteOne({ _id: id as any, email: me._id });
    return { ok: true };
  }
}
