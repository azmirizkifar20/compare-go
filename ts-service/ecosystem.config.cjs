module.exports = {
  apps: [
    {
      name: 'ts-service',
      script: 'npm',
      args: 'run start',
      cwd: '/var/www/html/compare-go-ts/ts-service',

      env: {
        PORT: 3305,
        NODE_ENV: 'production',
      },

      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,

      max_memory_restart: '300M',
    },
  ],
};