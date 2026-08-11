module.exports = {
  apps: [
    {
      name: 'kotovela-workbench-api',
      script: '/bin/zsh',
      args: [
        '-lc',
        'set -a; [ -f /Users/ztl/.kotovela-live/workbench-api.env ] && source /Users/ztl/.kotovela-live/workbench-api.env; set +a; exec node --import tsx server/local-server.mjs',
      ],
      cwd: __dirname,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 8812,
        KOTOVELA_API_ENV_FILE: '/Users/ztl/.kotovela-live/workbench-api.env',
      },
      error_file: 'logs/kotovela-workbench-api-error.log',
      out_file: 'logs/kotovela-workbench-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      cron_restart: '0 3 * * *',
    },
  ],
}
