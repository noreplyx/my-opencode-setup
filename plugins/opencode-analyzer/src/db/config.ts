import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database file location: plugin root (../../analyzer.db from dist/src/db/ or src/db/)
const DB_PATH = path.resolve(__dirname, '..', '..', '..', 'analyzer.db');

let dbPath = DB_PATH;

export function getDbPath(): string {
  return dbPath;
}

export function setDbPath(p: string): void {
  dbPath = p;
}
