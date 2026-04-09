import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as net from 'node:net';
import * as express from 'express';
import { join } from 'node:path';

async function canListen(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

async function findAvailablePort(
  host: string,
  startPort: number,
  maxAttempts: number,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    // eslint-disable-next-line no-await-in-loop
    const ok = await canListen(host, port);
    if (ok) return port;
  }

  throw new Error(
    `Aucun port libre trouvé entre ${startPort} et ${startPort + maxAttempts - 1}.`,
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prefix all REST routes with /api (e.g. /api/auth/login)
  app.setGlobalPrefix('api');

  // Enable validation pipe globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Enable CORS
  app.enableCors();

  // Static files for uploaded avatars
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('FootSmart Backend API')
    .setDescription('API documentation for FootSmart betting and prediction platform')
    .setVersion('1.0')
    .addTag('Health')
    .addTag('Auth')
    .addTag('Users')
    .addTag('Matches')
    .addTag('Predictions')
    .addTag('Bets')
    .addTag('Wallet')
    .addTag('Analytics')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const host = '0.0.0.0';
  const requestedPort = Number(process.env.PORT ?? 3001);
  const maxAttempts = 50;

  const port = await findAvailablePort(host, requestedPort, maxAttempts);

  await app.listen(port, host);
  console.log(`🚀 Application is running on: http://0.0.0.0:${port}/api`);
  console.log(`📱 Access from emulator: http://10.0.2.2:${port}/api`);
  if (port !== requestedPort) {
    console.log(`⚠️  Port ${requestedPort} occupé, démarré sur ${port} à la place.`);
  }
}
bootstrap();
