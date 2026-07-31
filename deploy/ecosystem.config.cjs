/**
 * pm2 process definition.
 *
 * `next` is invoked directly rather than through `npm start`, so pm2 supervises
 * the server process itself instead of an npm wrapper — otherwise a crash leaves
 * pm2 watching a shell that has already exited, and reload/restart target the
 * wrong process.
 */
module.exports = {
  apps: [
    {
      name: 'restro-pos',
      cwd: __dirname + '/..',
      script: './node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      // One instance, deliberately. SQLite takes a single writer, and a second
      // process would fight the first for the database file.
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        // Bound to loopback: Caddy is the only thing that should reach it, so
        // the app is never exposed on the public interface without TLS.
        HOSTNAME: '127.0.0.1',
        TZ: 'Asia/Kolkata',
      },
      max_memory_restart: '500M',
      autorestart: true,
      // A crash loop should be visible in `pm2 status`, not hidden by instant
      // restarts.
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 2000,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
