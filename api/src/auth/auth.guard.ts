import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { bearer } from '../common/crypto';

// Resolves the bearer token (session or API token) → user, and attaches it to the request.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = await this.auth.userFromToken(bearer(req.headers['authorization']));
    if (!user) throw new UnauthorizedException('Sign in required');
    req.user = user;
    return true;
  }
}
