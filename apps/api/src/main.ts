import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from './config/env';

async function main() {
  const config = env();
  // rawBody: provider callbacks are authenticated by an HMAC over the exact request bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  Logger.log(`API listening on :${config.PORT} (${config.NODE_ENV})`, 'Bootstrap');
}

void main();
