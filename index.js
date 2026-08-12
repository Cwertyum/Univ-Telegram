import dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';
import tgDb from './database/dbManager.js';
import { startTelegramBridge, getPending2FARequest, sendCommandToPlugin } from './modules/telegramBridge.js';
import { registerAdminCommands } from './commands/adminCommands.js';

dotenv.config();

const botToken = (process.env.TELEGRAM_BOT_TOKEN || '8823283417:AAHmdCiaHceUlMeeIrTtq2DCzp5Q5jqTcOE').trim();

console.log('====================================================');
console.log('  UniversalAuth Enterprise Telegram Bot Starting... ');
console.log('====================================================');

const bot = new Telegraf(botToken);

// 1. Interactive Main Menu Keyboard
const mainMenuKeyboard = Markup.keyboard([
  ['📊 Мой Профиль', '🛡️ 2FA Статус'],
  ['🔑 Активировать 2FA', '🛠️ Админ Панель']
]).resize();

// 2. Start Command
bot.start((ctx) => {
  const welcomeMessage = `👋 *Добро пожаловать в UniversalAuth Telegram Бот!*\n\n` +
    `Этот бот защищает ваш аккаунт в Minecraft с помощью двухфакторной аутентификации (2FA) ` +
    `и позволяет управлять профилем напрямую из Telegram.\n\n` +
    `📌 *Быстрый старт:*\n` +
    `1. Введите \`/2fa\` в игре Minecraft для получения кода активации.\n` +
    `2. Отправьте команду \`/activate <ваш_код>\` этому боту.\n` +
    `3. Готово! Теперь при входе на сервер вы будете получать интерактивные кнопки подтверждения.`;

  ctx.replyWithMarkdown(welcomeMessage, mainMenuKeyboard);
});

// 3. Register Admin Commands (/mc_freeze, /mc_unfreeze, /mc_kick, /mc_changepass, /mc_userinfo, /admin)
registerAdminCommands(bot);

// 4. Command /activate <code>
bot.command('activate', async (ctx) => {
  const text = ctx.message.text.trim();
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    return ctx.replyWithMarkdown('⚠️ *Использование:* `/activate <ваш_ключ_из_minecraft>`');
  }

  const inputKey = parts[1].trim();
  const player = tgDb.getAuthPlayerBySecretKey(inputKey);

  if (!player) {
    return ctx.replyWithMarkdown('❌ *Неверный ключ активации!*\nУбедитесь, что вы ввели код правильно из Minecraft (`/2fa`).');
  }

  player.is_2fa_enabled = true;
  player.telegram_id = String(ctx.from.id);
  player.secret_key = null; // Clear key after use
  tgDb.saveAuthPlayer(player);

  sendCommandToPlugin('2FA_ACTIVATED', { username: player.username, telegramId: String(ctx.from.id) });

  const successText = `✅ *2FA УСПЕШНО ПОДКЛЮЧЕНА!*\n\n` +
    `Ваш Telegram аккаунт привязан к профилю *${player.display_name}* в Minecraft.\n` +
    `Теперь при попытке входа вы будете получать запрос с кнопками Подтвердить / Отклонить!`;

  await ctx.replyWithMarkdown(successText, mainMenuKeyboard);
});

// 5. Text Menu Buttons Handling
bot.hears('📊 Мой Профиль', (ctx) => showProfile(ctx));
bot.hears('🛡️ 2FA Статус', (ctx) => showProfile(ctx));
bot.hears('🔑 Активировать 2FA', (ctx) => {
  ctx.replyWithMarkdown('🔑 Введите \`/2fa\` в игре Minecraft, а затем отправьте сюда команду:\n\n`/activate <полученный_код>`');
});
bot.hears('🛠️ Админ Панель', (ctx) => {
  ctx.replyWithMarkdown('🛠️ Введите \`/admin\` для открытия административной панели управления.');
});

function showProfile(ctx) {
  const player = tgDb.getAuthPlayerByTelegramId(ctx.from.id);

  if (!player) {
    return ctx.replyWithMarkdown(
      'ℹ️ *Профиль не привязан!*\n\nЗайдите на сервер Minecraft, введите `/2fa` и отправьте полученный код через команду `/activate <код>`.',
      mainMenuKeyboard
    );
  }

  const profileText = `👤 *ВАШ ПРОФИЛЬ MINECRAFT*\n\n` +
    `• *Никнейм:* \`${player.display_name}\`\n` +
    `• *2FA Защита:* ${player.is_2fa_enabled ? '✅ Включена' : '❌ Отключена'}\n` +
    `• *Статус:* ${player.is_frozen ? '❄️ Заморожен' : '🟢 Активен'}\n` +
    `• *IP входа:* \`${player.ip_address || '127.0.0.1'}\`\n` +
    `• *Регистрация:* ${new Date(player.registration_date || Date.now()).toLocaleDateString('ru-RU')}`;

  ctx.replyWithMarkdown(profileText, mainMenuKeyboard);
}

// 6. Callback Query Actions for Interactive Buttons (✅ Принять / ❌ Отклонить)
bot.action(/tg_accept_(.+)/, async (ctx) => {
  const requestId = ctx.match[1];
  const reqData = getPending2FARequest(requestId);

  if (reqData) {
    reqData.status = 'APPROVED';
    await ctx.answerCbQuery('✅ Вход разрешен!');
    await ctx.editMessageText(
      `✅ *ВХОД В MINECRAFT ПОДТВЕРЖДЕН!*\n\n` +
      `👤 Никнейм: *${reqData.displayName}*\n` +
      `🌐 IP: \`${reqData.ipAddress}\`\n` +
      `🕒 Время: ${new Date().toLocaleTimeString('ru-RU')}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.answerCbQuery('⚠️ Время запроса истекло или запрос не найден.', { show_alert: true });
  }
});

bot.action(/tg_refuse_(.+)/, async (ctx) => {
  const requestId = ctx.match[1];
  const reqData = getPending2FARequest(requestId);

  if (reqData) {
    reqData.status = 'REJECTED';
    await ctx.answerCbQuery('⛔ Вход отклонен! Игрок кикнут.', { show_alert: true });
    await ctx.editMessageText(
      `⛔ *ВХОД В MINECRAFT ОТКЛОНЕН!*\n\n` +
      `👤 Никнейм: *${reqData.displayName}*\n` +
      `🌐 IP: \`${reqData.ipAddress}\`\n` +
      `🚨 Игрок немедленно кикнут с сервера.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.answerCbQuery('⚠️ Время запроса истекло или запрос не найден.', { show_alert: true });
  }
});

// Error Handling
bot.catch((err, ctx) => {
  console.error(`[Telegraf Error] for ${ctx.updateType}`, err);
});

// Launch HTTP REST Bridge for Plugin Communication
startTelegramBridge(bot);

// Launch Telegraf Bot
bot.launch().then(() => {
  console.log('[Telegram Bot] Бот успешно авторизован и запущен в режиме Long Polling!');
}).catch(err => {
  console.error('[Telegram Bot Launch Error]', err.message);
});

// Graceful Shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
