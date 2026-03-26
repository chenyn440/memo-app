module.exports = {
  apps: [
    {
      name: '__APP_NAME__',
      script: 'scripts/meeting-signal-server.mjs',
      cwd: '__PROJECT_DIR__',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        MEETING_SIGNAL_HOST: '127.0.0.1',
        MEETING_SIGNAL_PORT: '__SIGNAL_PORT__',
      },
      error_file: '__PROJECT_DIR__/logs/meeting-signal-error.log',
      out_file: '__PROJECT_DIR__/logs/meeting-signal-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
