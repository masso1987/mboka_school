import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestContextMiddleware } from './common/observability';
import { env } from './config/env';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and the e2e tests so both run the same middleware stack. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = env();
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.setGlobalPrefix(API_PREFIX);

  if (config.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Mboka School System API')
        .setVersion('1.0')
        .addCookieAuth('mboka_sid')
        .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' }, 'csrf')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}
