// Load .env (if present) before any other module reads process.env. Must be the first import.
try { process.loadEnvFile(); } catch { /* no .env file — use real environment variables */ }
