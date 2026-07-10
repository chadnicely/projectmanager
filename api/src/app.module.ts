import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { StateModule } from './state/state.module';
import { TokensModule } from './tokens/tokens.module';
import { McpModule } from './mcp/mcp.module';
import { OAuthModule } from './oauth/oauth.module';

@Module({
  imports: [DatabaseModule, AuthModule, StateModule, TokensModule, McpModule, OAuthModule],
  controllers: [HealthController],
})
export class AppModule {}
