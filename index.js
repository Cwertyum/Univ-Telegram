import http from 'http';
import dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';
import db from '../database/db.js';
import { sendCommandToPlugin } from '../modules/universalAuthBridge.js';

dotenv.config();

const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const apiKeySetting = (process.env.BRIDGE_API_KEY || '').trim();
const port = parseInt(process.env.TG_BRIDGE_PORT || '3002', 10);

const pending2FA = new Map();
let bot = null;

console.log('====================================================');
console.log('  UniversalAuth Telegram Bot Project Starting...    ');
console.log('====================================================');

if (botToken && botToken !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  try {
    bot = new Telegraf(botToken);
    setupTelegramBot(bot);
    bot.launch();
    console.log('[Telegram Bot] Бот успешно запущен в Telegram!');
  } catch (err) {
    console.error('[Telegram Bot Error] Ошибка запуска бота:', err.message);
  }
} else {
  console.log('[Telegram Bot] TELEGRAM_BOT_TOKEN не указан. HTTP Мост запущен в ожидании токена.');
}

// ── HTTP REST API BRIDGE FOR TELEGRAM ─────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/tg-2fa-request' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { requestId, username, ipAddress } = body;

      const player = db.getAuthPlayer(username);
      if (!player || !player.discord_id) { // discord_id column holds telegram chatId or discord id
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Player or linked Telegram ID not found' }));
      }

      const reqData = {
        requestId,
        username: player.username,
        displayName: player.display_name || username,
        telegramId: player.discord_id,
        ipAddress: ipAddress || '127.0.0.1',
        status: 'PENDING',
        timestamp: Date.now()
      };
      pending2FA.set(requestId, reqData);

      if (bot) {
        try {
          const text = `🛡️ *UniversalAuth 2FA*\n\nПопытка входа в аккаунт *${reqData.displayName}* в Minecraft!\n🌐 *IP:* \`${ipAddress}\`\n⏰ *Время:* ${new Date().toLocaleTimeString('ru-RU')}`;
          const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('✅ Принять', `tg_accept_${requestId}`),
            Markup.button.callback('❌ Отказать (Kick)', `tg_refuse_${requestId}`)
          ]);

          await bot.telegram.sendMessage(player.discord_id, text, { parse_mode: 'Markdown', ...keyboard });
        } catch (tgErr) {
          console.error('[Telegram Bot Bridge Error] Ошибка отправки 2FA сообщения:', tgErr.message);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'OK' }));
    }

    if (pathname === '/api/tg-2fa-status' && req.method === 'GET') {
      const requestId = url.searchParams.get('requestId');
      const reqData = pending2FA.get(requestId);
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

    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Endpoint not found' }));

  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(port, () => {
  console.log(`[Telegram HTTP REST Bridge] Слушает запросы на порту :${port}`);
});

// ── TELEGRAF BOT SETUP & HANDLERS ──────────────────────────────
function setupTelegramBot(botApp) {
  botApp.start((ctx) => {
    ctx.reply('👋 Привет! Я UniversalAuth Telegram Бот.\n\nКоманды:\n/activate <ключ> — Активация 2FA по ключу из Minecraft (/2fa)\n/status — Проверить статус 2FA\n/mc_freeze <ник> — Заморозить аккаунт\n/mc_unfreeze <ник> — Разморозить аккаунт\n/mc_kick <ник> — Кикнуть игрока');
  });

  botApp.command('activate', async (ctx) => {
    const text = ctx.message.text.trim();
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('⚠️ Использование: /activate <ключ_из_minecraft>');
    }

    const key = parts[1].trim();
    const player = db.getAuthPlayerBySecretKey(key);

    if (!player) {
      return ctx.reply('❌ Неверный ключ активации! Убедитесь, что вы правильно ввели код из игры (/2fa).');
    }

    player.is_2fa_enabled = true;
    player.discord_id = String(ctx.from.id);
    player.secret_key = null;
    db.saveAuthPlayer(player);

    sendCommandToPlugin('2FA_ACTIVATED', { username: player.username, discordId: String(ctx.from.id) });
    ctx.reply(`✅ *2FA Успешно Привязана!*\n\nВаш Telegram аккаунт привязан к профилю *${player.display_name}* в Minecraft.`, { parse_mode: 'Markdown' });
  });

  botApp.command('status', (ctx) => {
    const player = db.getAuthPlayerByDiscordId(String(ctx.from.id));
    if (!player) {
      return ctx.reply('ℹ️ К вашему Telegram аккаунту не привязан ни один никнейм Minecraft. Введите /2fa в игре.');
    }

    ctx.reply(`📋 *Профиль Minecraft: ${player.display_name}*\n\n🛡️ 2FA: ${player.is_2fa_enabled ? '✅ Включена' : '❌ Отключена'}\n❄️ Заморожен: ${player.is_frozen ? '❄️ Да' : '🟢 Нет'}\n🌐 IP: \`${player.ip_address}\``, { parse_mode: 'Markdown' });
  });

  // Action Buttons Handler (✅ Принять / ❌ Отказать)
  botApp.action(/tg_accept_(.+)/, async (ctx) => {
    const requestId = ctx.match[1];
    const reqData = pending2FA.get(requestId);
    if (reqData) {
      reqData.status = 'APPROVED';
      await ctx.editMessageText(`✅ *Вход в Minecraft Подтвержден!*\n\nАккаунт: *${reqData.displayName}*`, { parse_mode: 'Markdown' });
    } else {
      await ctx.answerCbQuery('⚠️ Запрос устарел.');
    }
  });

  botApp.action(/tg_refuse_(.+)/, async (ctx) => {
    const requestId = ctx.match[1];
    const reqData = pending2FA.get(requestId);
    if (reqData) {
      reqData.status = 'REJECTED';
      await ctx.editMessageText(`⛔ *Вход Отклонен!*\n\nИгрок *${reqData.displayName}* кикнут с сервера.`, { parse_mode: 'Markdown' });
    } else {
      await ctx.answerCbQuery('⚠️ Запрос устарел.');
    }
  });
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
