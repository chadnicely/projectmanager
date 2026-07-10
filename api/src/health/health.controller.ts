import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('api/health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async health() {
    try {
      const db = await this.database.db();
      await db.command({ ping: 1 });
      return { ok: true, db: db.databaseName };
    } catch (e) {
      throw new HttpException({ ok: false, error: (e as Error).message }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
