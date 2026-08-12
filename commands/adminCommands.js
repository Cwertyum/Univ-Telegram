import { Markup } from 'telegraf';
import crypto from 'crypto';
import tgDb from '../database/dbManager.js';
import { sendCommandToPlugin } from '../modules/telegramBridge.js';

function hashPassword(password, salt = 'UniversalAuthSalt2026') {
  return '$SHA$' + salt + '$' + crypto.createHash('sha256').update(password + salt).digest('hex');
}

export function registerAdminCommands(bot) {
  // 1. /mc_freeze <player> [reason]
  bot.command('mc_freeze', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('⚠️ Использование: /mc_freeze <никнейм> [причина]');
    }

    const targetUsername = parts[1].trim();
    const reason = parts.slice(2).join(' ') || 'Заморожен администратором через Telegram';

    const player = tgDb.getAuthPlayer(targetUsername) || { username: targetUsername.toLowerCase(), display_name: targetUsername };
    player.is_frozen = true;
    tgDb.saveAuthPlayer(player);

    sendCommandToPlugin('FREEZE_PLAYER', { username: player.username, reason });

    await ctx.reply(`❄️ *АККАУНТ ЗАМОРОЖЕН*\n\nИгрок: *${player.display_name}*\nПричина: _${reason}_\nВход на сервер заблокирован.`, { parse_mode: 'Markdown' });
  });

  // 2. /mc_unfreeze <player>
  bot.command('mc_unfreeze', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('⚠️ Использование: /mc_unfreeze <никнейм>');
    }

    const targetUsername = parts[1].trim();
    const player = tgDb.getAuthPlayer(targetUsername);

    if (!player) {
      return ctx.reply(`❌ Игрок *${targetUsername}* не найден в базе данных.`, { parse_mode: 'Markdown' });
    }

    player.is_frozen = false;
    tgDb.saveAuthPlayer(player);

    sendCommandToPlugin('UNFREEZE_PLAYER', { username: player.username });

    await ctx.reply(`🔥 *АККАУНТ РАЗМОРОЖЕН*\n\nИгрок: *${player.display_name}*\nВход на сервер разрешен.`, { parse_mode: 'Markdown' });
  });

  // 3. /mc_kick <player> [reason]
  bot.command('mc_kick', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('⚠️ Использование: /mc_kick <никнейм> [причина]');
    }

    const targetUsername = parts[1].trim();
    const reason = parts.slice(2).join(' ') || 'Кикнут администратором через Telegram';

    sendCommandToPlugin('KICK_PLAYER', { username: targetUsername, reason });

    await ctx.reply(`👢 *КОМАНДА КИКА ОТПРАВЛЕНА*\n\nИгрок: *${targetUsername}*\nПричина: _${reason}_`, { parse_mode: 'Markdown' });
  });

  // 4. /mc_changepass <player> <newpassword>
  bot.command('mc_changepass', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply('⚠️ Использование: /mc_changepass <никнейм> <новый_пароль>');
    }

    const targetUsername = parts[1].trim();
    const newPassword = parts[2].trim();

    const player = tgDb.getAuthPlayer(targetUsername);
    if (!player) {
      return ctx.reply(`❌ Игрок *${targetUsername}* не найден в базе данных.`, { parse_mode: 'Markdown' });
    }

    const newHash = hashPassword(newPassword);
    player.password_hash = newHash;
    tgDb.saveAuthPlayer(player);

    sendCommandToPlugin('CHANGE_PASS', { username: player.username, newPasswordHash: newHash });

    await ctx.reply(`🔑 *ПАРОЛЬ УСПЕШНО ИЗМЕНЕН*\n\nАккаунт: *${player.display_name}*\nНовый пароль установлен.`, { parse_mode: 'Markdown' });
  });

  // 5. /mc_userinfo <player>
  bot.command('mc_userinfo', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply('⚠️ Использование: /mc_userinfo <никнейм>');
    }

    const targetUsername = parts[1].trim();
    const player = tgDb.getAuthPlayer(targetUsername);

    if (!player) {
      return ctx.reply(`❌ Игрок *${targetUsername}* не найден в базе данных.`, { parse_mode: 'Markdown' });
    }

    const infoText = `📋 *ПРОФИЛЬ ИГРОКА MINECRAFT*\n\n` +
      `👤 *Никнейм:* \`${player.display_name}\`\n` +
      `🌐 *IP-Адрес:* \`${player.ip_address || '127.0.0.1'}\`\n` +
      `🛡️ *2FA Статус:* ${player.is_2fa_enabled ? '✅ Включена' : '❌ Отключена'}\n` +
      `❄️ *Заморозка:* ${player.is_frozen ? '❄️ Заморожен' : '🟢 Активен'}\n` +
      `💬 *Telegram ID:* \`${player.telegram_id || 'Не привязан'}\`\n` +
      `📅 *Регистрация:* ${new Date(player.registration_date || Date.now()).toLocaleString('ru-RU')}\n` +
      `🕒 *Последний вход:* ${new Date(player.last_login || Date.now()).toLocaleString('ru-RU')}`;

    await ctx.reply(infoText, { parse_mode: 'Markdown' });
  });

  // 6. /admin Interactive Panel
  bot.command('admin', async (ctx) => {
    const allPlayers = tgDb.getAllPlayers();
    const frozenCount = allPlayers.filter(p => p.is_frozen).length;
    const faCount = allPlayers.filter(p => p.is_2fa_enabled).length;

    const adminText = `🛠️ *ПАНЕЛЬ АДМИНИСТРИРОВАНИЯ UNIVERSALAUTH*\n\n` +
      `📊 *Всего игроков в БД:* ${allPlayers.length}\n` +
      `🛡️ *Игроков с 2FA:* ${faCount}\n` +
      `❄️ *Замороженных аккаунтов:* ${frozenCount}\n\n` +
      `Доступные команды:\n` +
      `• /mc_userinfo <ник>\n` +
      `• /mc_freeze <ник> [причина]\n` +
      `• /mc_unfreeze <ник>\n` +
      `• /mc_kick <ник> [причина]\n` +
      `• /mc_changepass <ник> <пароль>`;

    await ctx.reply(adminText, { parse_mode: 'Markdown' });
  });
}
