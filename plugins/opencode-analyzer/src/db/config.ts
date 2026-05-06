import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try multiple possible locations for .env — works whether loaded from 
// dist/src/db/config.js (3 levels deep) or src/db/config.ts (2 levels deep)
const possiblePaths = [
  path.resolve(__dirname, '..', '..', '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
  path.resolve(__dirname, '..', '.env'),
];

let envPath = '';
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    envPath = p;
    break;
  }
}

if (envPath) {
  dotenv.config({ path: envPath });
}

let connectionString: string | undefined = process.env.DATABASE_URL;

export function getConnectionString(): string {
  if (connectionString) return connectionString;
  throw new Error(
    'DATABASE_URL environment variable is not set. ' +
    'Create a .env file at ' + envPath + ' with DATABASE_URL=postgres://user:pass@host:port/database'
  );
}

export function setConnectionString(url: string): void {
  connectionString = url;
}
