import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableCors();
  app.use(json({ limit: '16mb' })); // workspaces (with embedded images) can be large
  app.use(urlencoded({ extended: true, limit: '16mb' }));
  const port = Number(process.env.PORT) || 4200;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Base API (NestJS) listening on http://localhost:${port}`);
}
bootstrap();
