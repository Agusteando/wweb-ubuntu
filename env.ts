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

  // External integration API
  INTEGRATION_ADMIN_TOKEN: Env.schema.string.optional(),
  INTEGRATION_PUBLIC_BASE_URL: Env.schema.string.optional(),

  // WhatsApp runtime durability tuning. Defaults are handled in BotService when unset.
  WA_SESSION_BACKUP_RETENTION: Env.schema.string.optional(),
  WA_HEALTH_INTERVAL_MS: Env.schema.string.optional(),
  WA_READY_TIMEOUT_MS: Env.schema.string.optional(),
  WA_PROBE_TIMEOUT_MS: Env.schema.string.optional(),
  WA_RECOVERY_FAILURE_THRESHOLD: Env.schema.string.optional(),
  WA_RECOVERY_DELAY_MS: Env.schema.string.optional(),
  WA_RECOVERY_BACKOFF_MS: Env.schema.string.optional(),
  WA_DESTROY_TIMEOUT_MS: Env.schema.string.optional(),
  WA_SHUTDOWN_TIMEOUT_MS: Env.schema.string.optional(),
  WA_SCHEDULED_RECYCLE_HOURS: Env.schema.string.optional(),

  // Buena Infancia Scraping Credentials
  BUENAINFANCIA_USERNAME: Env.schema.string.optional(),
  BUENAINFANCIA_PASSWORD: Env.schema.string.optional(),

  // MySQL Database Config
  DB_HOST: Env.schema.string.optional(),
  DB_USER: Env.schema.string.optional(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optional(),

  // Attendance and SSN automation settings
  ATTENDANCE_REPORT_ENDPOINT: Env.schema.string.optional(),
  SSN_RSS_URL: Env.schema.string.optional(),
  SSN_CHECK_INTERVAL_MS: Env.schema.string.optional(),
  SSN_MAJOR_MAGNITUDE_THRESHOLD: Env.schema.string.optional(),
  SSN_MAJOR_ALERT_CHAT_IDS: Env.schema.string.optional(),
  SSN_MINOR_ALERT_CHAT_IDS: Env.schema.string.optional(),
})
