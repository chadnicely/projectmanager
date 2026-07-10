import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StateController } from './state.controller';
import { StateService } from './state.service';

@Module({
  imports: [AuthModule],
  controllers: [StateController],
  providers: [StateService],
  exports: [StateService],
})
export class StateModule {}
