require("reflect-metadata");

const { NestFactory } = require("@nestjs/core");
const { ensureDatabaseUrl } = require("./config/runtime-env");
const { AppModule } = require("./app.module");

ensureDatabaseUrl();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
}

bootstrap();
