import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { StateModule } from './state/state.module';
import { TokensModule } from './tokens/tokens.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [DatabaseModule, AuthModule, StateModule, TokensModule, McpModule],
  controllers: [HealthController],
})
export class AppModule {}
