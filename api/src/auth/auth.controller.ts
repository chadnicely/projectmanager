import { Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { bearer } from '../common/crypto';

interface Creds { email?: string; password?: string; name?: string }

@Controller('api')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  signup(@Body() b: Creds) {
    return this.auth.signup(b.email || '', b.password || '', b.name);
  }

  @Post('login')
  login(@Body() b: Creds) {
    return this.auth.login(b.email || '', b.password || '');
  }

  @Post('logout')
  logout(@Headers('authorization') a?: string) {
    return this.auth.logout(bearer(a));
  }

  @Get('me')
  async me(@Headers('authorization') a?: string) {
    const u = await this.auth.userFromToken(bearer(a));
    if (!u) throw new UnauthorizedException('Not signed in');
    return { user: this.auth.publicUser(u) };
  }
}
