import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, '..', '..', 'analyzer.log');

export function log(level: string, message: string, data: unknown = null): void {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ' | ' + JSON.stringify(data).substring(0, 500) : '';
  const line = `[${timestamp}] [${level}] ${message}${dataStr}\n`;
  
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (err) {
    // Can't log if write fails
  }
}

export function clearLog(): void {
  try {
    fs.writeFileSync(LOG_PATH, '');
  } catch (err) {
    // Silently ignore
  }
}
