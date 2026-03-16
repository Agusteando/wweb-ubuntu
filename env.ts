import Env from '@ioc:Adonis/Core/Env'

export default Env.rules({
  HOST: Env.schema.string({ format: 'host' }),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  APP_NAME: Env.schema.string(),
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  
  WA_SESSION_DIR: Env.schema.string.optional(),
  
  // Reconciled Google Credentials variables (both are accepted, GOOGLE_ is preferred)
  GOOGLE_CREDENTIALS_PATH: Env.schema.string.optional(),
  CREDENTIALS_PATH: Env.schema.string.optional(),
  
  G_SUITE_ADMIN_EMAIL: Env.schema.string.optional(),
  G_SUITE_DOMAIN: Env.schema.string.optional(),
  DRIVE_DEFAULT_FOLDER_ID: Env.schema.string.optional(),
  
  OPENAI_API_KEY: Env.schema.string.optional(),
  
  // Adobe PDF Services credentials
  ADOBE_CLIENT_ID: Env.schema.string.optional(),
  ADOBE_CLIENT_SECRET: Env.schema.string.optional(),
  ADOBE_ORGANIZATION_ID: Env.schema.string.optional(),
  
  ADMIN_USERNAME: Env.schema.string(),
  ADMIN_PASSWORD: Env.schema.string(),
})