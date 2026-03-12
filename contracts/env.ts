declare module '@ioc:Adonis/Core/Env' {
  type CustomEnv = typeof import('../env').default
  interface EnvTypes extends CustomEnv {}
}