import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../Discord-Bot/database/bot_database.json');

class TelegramDBManager {
  constructor(filePath) {
    this.filePath = filePath;
    this.tables = { universal_auth: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.universal_auth) {
          this.tables.universal_auth = parsed.universal_auth;
        }
      }
    } catch (e) {
      console.error('[Telegram DB] Error loading DB file:', e.message);
    }
  }

  save() {
    try {
      let currentData = {};
      if (fs.existsSync(this.filePath)) {
        try {
          currentData = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        } catch {}
      }
      currentData.universal_auth = this.tables.universal_auth;
      fs.writeFileSync(this.filePath, JSON.stringify(currentData, null, 2), 'utf8');
    } catch (e) {
      console.error('[Telegram DB] Error saving DB file:', e.message);
    }
  }

  getAuthPlayer(username) {
    if (!username) return null;
    this.load();
    const key = String(username).toLowerCase();
    return this.tables.universal_auth[key] || null;
  }

  getAuthPlayerBySecretKey(secretKey) {
    if (!secretKey) return null;
    this.load();
    const cleanInput = String(secretKey).trim().toLowerCase();
    const strippedInput = cleanInput.replace(/[^a-z0-9]/g, '');

    return Object.values(this.tables.universal_auth).find(p => {
      if (!p.secret_key) return false;
      const storedClean = String(p.secret_key).trim().toLowerCase();
      const storedStripped = storedClean.replace(/[^a-z0-9]/g, '');
      return storedClean === cleanInput || (storedStripped.length > 0 && storedStripped === strippedInput);
    }) || null;
  }

  getAuthPlayerByTelegramId(telegramId) {
    if (!telegramId) return null;
    this.load();
    const tid = String(telegramId);
    return Object.values(this.tables.universal_auth).find(
      p => String(p.discord_id) === tid || String(p.telegram_id) === tid
    ) || null;
  }

  saveAuthPlayer(data) {
    if (!data || !data.username) return false;
    this.load();
    const key = String(data.username).toLowerCase();
    const existing = this.tables.universal_auth[key] || {};

    this.tables.universal_auth[key] = {
      username: key,
      display_name: data.display_name || existing.display_name || data.username,
      password_hash: data.password_hash || existing.password_hash || '',
      ip_address: data.ip_address || existing.ip_address || '127.0.0.1',
      registration_date: data.registration_date || existing.registration_date || Date.now(),
      last_login: data.last_login || existing.last_login || Date.now(),
      is_2fa_enabled: data.is_2fa_enabled !== undefined ? Boolean(data.is_2fa_enabled) : Boolean(existing.is_2fa_enabled),
      discord_id: data.discord_id !== undefined ? data.discord_id : (existing.discord_id || null),
      telegram_id: data.telegram_id !== undefined ? data.telegram_id : (existing.telegram_id || null),
      secret_key: data.secret_key !== undefined ? data.secret_key : (existing.secret_key || null),
      is_frozen: data.is_frozen !== undefined ? Boolean(data.is_frozen) : Boolean(existing.is_frozen)
    };
    this.save();
    return true;
  }

  getAllPlayers() {
    this.load();
    return Object.values(this.tables.universal_auth);
  }
}

const tgDb = new TelegramDBManager(dbPath);
export default tgDb;
