module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      script: './server.js',
      cwd: './build',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};