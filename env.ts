import Env from '@ioc:Adonis/Core/Env'

export default Env.rules({
  HOST: Env.schema.string({ format: 'host' }),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  APP_NAME: Env.schema.string(),
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  
  // Mandatory Runtime External Paths
  WA_SESSION_DIR: Env.schema.string(),
  GOOGLE_CREDENTIALS_PATH: Env.schema.string(),
  
  G_SUITE_ADMIN_EMAIL: Env.schema.string.optional(),
  G_SUITE_DOMAIN: Env.schema.string.optional(),
  DRIVE_DEFAULT_FOLDER_ID: Env.schema.string.optional(),
  
  OPENAI_API_KEY: Env.schema.string.optional(),
  
  ADOBE_CLIENT_ID: Env.schema.string.optional(),
  ADOBE_CLIENT_SECRET: Env.schema.string.optional(),
  ADOBE_ORGANIZATION_ID: Env.schema.string.optional(),
  
  ADMIN_USERNAME: Env.schema.string(),
  ADMIN_PASSWORD: Env.schema.string(),

  // Buena Infancia Scraping Credentials
  BUENAINFANCIA_USERNAME: Env.schema.string.optional(),
  BUENAINFANCIA_PASSWORD: Env.schema.string.optional(),

  // MySQL Database Config
  DB_HOST: Env.schema.string.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optional(),
})