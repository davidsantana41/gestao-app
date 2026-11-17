// The browser harness validates automatic sync and reset only in guarded demo fixtures.
process.argv[2] ||= '.backups/manual-sync';
await import('./check-auto-reset.mjs');
