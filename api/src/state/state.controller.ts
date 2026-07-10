import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserDoc } from '../auth/auth.service';
import { StateService } from './state.service';

@Controller('api')
@UseGuards(AuthGuard)
export class StateController {
  constructor(private readonly state: StateService) {}

  @Get('state')
  getState(@CurrentUser() me: UserDoc) {
    return this.state.getState(me);
  }

  @Put('state')
  putState(@CurrentUser() me: UserDoc, @Body() body: Record<string, unknown>) {
    return this.state.putState(me, body);
  }

  @Post('op')
  op(@CurrentUser() me: UserDoc, @Body() body: Record<string, unknown>) {
    return this.state.op(me, body);
  }
}
