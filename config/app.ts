import proxyAddr from 'proxy-addr'
import Env from '@ioc:Adonis/Core/Env'
import { ServerConfig } from '@ioc:Adonis/Core/Server'
import { LoggerConfig } from '@ioc:Adonis/Core/Logger'

export const appKey: string = Env.get('APP_KEY')

export const http: ServerConfig = {
  allowMethodSpoofing: false,
  subdomainOffset: 2,
  generateRequestId: false,
  trustProxy: proxyAddr.compile('loopback'),
  etag: false,
  jsonpCallbackName: 'callback',
  cookie: {
    domain: '',
    path: '/',
    maxAge: '2h',
    httpOnly: true,
    secure: false,
    sameSite: false,
  },
  forceContentNegotiationTo: 'application/json',
}

export const logger: LoggerConfig = {
  name: Env.get('APP_NAME'),
  enabled: true,
  level: Env.get('LOG_LEVEL', 'info'),
  prettyPrint: Env.get('NODE_ENV') === 'development',
}

export const profiler = {
  enabled: true,
  blacklist: [],
  whitelist: [],
}

export const validator = {}