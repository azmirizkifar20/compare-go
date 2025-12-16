module.exports = {
  apps: [
    {
      name: 'ts-service',
      script: 'npm',
      args: 'run start',
      cwd: '/var/www/html/compare-go-ts/ts-service',

      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,

      max_memory_restart: '300M',
    },
  ],
};