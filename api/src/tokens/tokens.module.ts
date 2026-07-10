import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TokensController } from './tokens.controller';

@Module({
  imports: [AuthModule],
  controllers: [TokensController],
})
export class TokensModule {}
