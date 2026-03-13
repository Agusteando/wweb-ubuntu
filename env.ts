import Env from '@ioc:Adonis/Core/Env'

export default Env.rules({
  HOST: Env.schema.string({ format: 'host' }),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  APP_NAME: Env.schema.string(),
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  GOOGLE_CREDENTIALS_PATH: Env.schema.string.optional(),
  G_SUITE_ADMIN_EMAIL: Env.schema.string.optional(),
  G_SUITE_DOMAIN: Env.schema.string.optional(),
  DRIVE_DEFAULT_FOLDER_ID: Env.schema.string.optional(),
  ADMIN_USERNAME: Env.schema.string(),
  ADMIN_PASSWORD: Env.schema.string(),
})