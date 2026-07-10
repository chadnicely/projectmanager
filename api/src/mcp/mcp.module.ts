import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StateModule } from '../state/state.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [AuthModule, StateModule],
  controllers: [McpController],
})
export class McpModule {}
