module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      script: './build/server.js',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3333,
        HOST: '0.0.0.0'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3333,
        HOST: '0.0.0.0'
      },
    },
  ],
};