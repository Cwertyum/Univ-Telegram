import http from 'http';
import { Markup } from 'telegraf';
import tgDb from '../database/dbManager.js';

const pending2FARequests = new Map();
const pendingPluginCommands = [];

let bridgeServer = null;
let telegramBot = null;

export function startTelegramBridge(botInstance) {
  telegramBot = botInstance;
  const port = parseInt(process.env.TG_BRIDGE_PORT || '3002', 10);
  const apiKeySetting = (process.env.BRIDGE_API_KEY || 'UniversalAuthSecretApiKey2026').trim();

  if (bridgeServer) return bridgeServer;

  bridgeServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Secure API Key Header Check
    const reqApiKey = (req.headers['x-api-key'] || req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (apiKeySetting && reqApiKey && reqApiKey !== apiKeySetting) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '401 Unauthorized: Invalid X-API-Key' }));
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      // 1. POST /api/tg-2fa-request
      if (pathname === '/api/tg-2fa-request' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const { requestId, username, ipAddress } = body;

        if (!requestId || !username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing requestId or username' }));
        }

        const player = tgDb.getAuthPlayer(username);
        const tgId = player ? (player.telegram_id || player.discord_id) : null;

        if (!player || !tgId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Player or linked Telegram ID not found' }));
        }

        const requestData = {
          requestId,
          username: player.username,
          displayName: player.display_name || username,
          telegramId: tgId,
          ipAddress: ipAddress || '127.0.0.1',
          status: 'PENDING',
          timestamp: Date.now()
        };
        pending2FARequests.set(requestId, requestData);

        if (telegramBot) {
          try {
            const messageText = `🛡️ *ВХОД В MINECRAFT — 2FA ПРОВЕРКА*\n\n` +
              `👤 *Никнейм:* \`${player.display_name || username}\`\n` +
              `🌐 *IP-Адрес:* \`${ipAddress || '127.0.0.1'}\`\n` +
              `⏰ *Время:* ${new Date().toLocaleTimeString('ru-RU')}\n\n` +
              `⚠️ Подтвердите или отклоните попытку входа. У вас есть 60 секунд.`;

            const keyboard = Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ ПРИНЯТЬ ВХОД', `tg_accept_${requestId}`),
                Markup.button.callback('❌ ОТКЛОНИТЬ И КИКНУТЬ', `tg_refuse_${requestId}`)
              ]
            ]);

            const msg = await telegramBot.telegram.sendMessage(tgId, messageText, {
              parse_mode: 'Markdown',
              ...keyboard
            });
            requestData.tgMessageId = msg.message_id;
          } catch (err) {
            console.error(`[Telegram Bridge Error] Ошибка отправки 2FA в Telegram пользователю ${tgId}:`, err.message);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'OK', sent: true }));
      }

      // 2. GET /api/tg-2fa-status
      if (pathname === '/api/tg-2fa-status' && req.method === 'GET') {
        const requestId = url.searchParams.get('requestId');
        const reqData = pending2FARequests.get(requestId);

        if (!reqData) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'NOT_FOUND' }));
        }

        if (reqData.status === 'PENDING' && Date.now() - reqData.timestamp > 60000) {
          reqData.status = 'EXPIRED';
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: reqData.status }));
      }

      // 3. POST /api/sync-player
      if (pathname === '/api/sync-player' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (body && body.username) {
          tgDb.saveAuthPlayer(body);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'OK' }));
      }

      // 4. GET /api/poll-commands
      if (pathname === '/api/poll-commands' && req.method === 'GET') {
        const commands = [...pendingPluginCommands];
        pendingPluginCommands.length = 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ commands }));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Endpoint not found' }));

    } catch (err) {
      console.error('[Telegram Bridge Server Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });

  bridgeServer.listen(port, () => {
    console.log(`[Telegram REST Bridge] Сервер успешно запущен на порту :${port}`);
  });

  return bridgeServer;
}

export function sendCommandToPlugin(commandType, data) {
  pendingPluginCommands.push({ type: commandType, data, timestamp: Date.now() });
}

export function getPending2FARequest(requestId) {
  return pending2FARequests.get(requestId);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
