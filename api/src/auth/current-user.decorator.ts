import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserDoc } from './auth.service';

// Grabs the user attached by AuthGuard.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserDoc => {
  return ctx.switchToHttp().getRequest().user;
});
