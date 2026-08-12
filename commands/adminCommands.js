import { Markup } from 'telegraf';
import crypto from 'crypto';
import tgDb from '../database/dbManager.js';
import { sendCommandToPlugin } from '../modules/telegramBridge.js';

function hashPassword(password, salt = 'UniversalAuthSalt2026') {
  return '$SHA$' + salt + '$' + crypto.createHash('sha256').update(password + salt).digest('hex');
}

/**
 * Helper to resolve target player and check permissions:
 * - Regular Telegram user: Can ONLY manage their OWN linked Minecraft account!
 * - Telegram Admin (listed in TG_ADMIN_IDS): Can manage ANY player.
 */
function resolveTargetPlayer(ctx, inputUsername) {
  const telegramId = String(ctx.from.id);
  const linkedPlayer = tgDb.getAuthPlayerByTelegramId(telegramId);
  const adminIdsStr = process.env.TELEGRAM_ADMIN_IDS || '';
  const adminIds = adminIdsStr.split(',').map(id => id.trim()).filter(Boolean);
  const isAdmin = adminIds.includes(telegramId);

  if (!inputUsername || inputUsername.trim().length === 0) {
    if (!linkedPlayer) {
      return { error: 'ℹ️ *К вашему Telegram аккаунту не привязан ни один профиль Minecraft.* Введите `/2fa` в игре и привяжите код через `/activate <код>`.' };
    }
    return { player: linkedPlayer, targetUsername: linkedPlayer.username, isSelf: true };
  }

  const cleanInput = inputUsername.trim().toLowerCase();

  if (linkedPlayer && linkedPlayer.username.toLowerCase() === cleanInput) {
    return { player: linkedPlayer, targetUsername: linkedPlayer.username, isSelf: true };
  }

  if (!isAdmin) {
    return { error: '⛔ *Ошибка доступа!* Вы можете управлять (кикать, замораживать, менять пароль) только *своим собственным аккаунтом Minecraft*!' };
  }

  const foundPlayer = tgDb.getAuthPlayer(cleanInput) || { username: cleanInput, display_name: inputUsername.trim() };
  return { player: foundPlayer, targetUsername: cleanInput, isSelf: false };
}

export function registerAdminCommands(bot) {
  // 1. /mc_freeze [player] [reason]
  bot.command('mc_freeze', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const inputPlayer = parts[1] && !parts[1].startsWith('/') ? parts[1].trim() : null;
    const reason = inputPlayer ? (parts.slice(2).join(' ') || 'Заморожен через Telegram') : (parts.slice(1).join(' ') || 'Заморожено владельцем через Telegram');

    const res = resolveTargetPlayer(ctx, inputPlayer);
    if (res.error) {
      return ctx.replyWithMarkdown(res.error);
    }

    const player = res.player;
    player.is_frozen = true;
    tgDb.saveAuthPlayer(player);

    sendCommandToPlugin('FREEZE_PLAYER', { username: player.username, reason });

    const message = res.isSelf
      ? `❄️ *ВАШ АККАУНТ ЗАМОРОЖЕН*\n\nВы успешно заморозили свой аккаунт *${player.display_name}*. Вход в игру временно заблокирован.`
      : `❄️ *АККАУНТ ЗАМОРОЖЕН АДМИНАМИ*\n\nИгрок: *${player.display_name}*\nПричина: _${reason}_`;

    await ctx.replyWithMarkdown(message);
  });

  // 2. /mc_unfreeze [player]
  bot.command('mc_unfreeze', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const inputPlayer = parts[1] && !parts[1].startsWith('/') ? parts[1].trim() : null;

    const res = resolveTargetPlayer(ctx, inputPlayer);
    if (res.error) {
      return ctx.replyWithMarkdown(res.error);
    }

    const player = res.player;
    player.is_frozen = false;
    tgDb.saveAuthPlayer(player);

    sendCommandToPlugin('UNFREEZE_PLAYER', { username: player.username });

    const message = res.isSelf
      ? `🔥 *ВАШ АККАУНТ РАЗМОРОЖЕН*\n\nВы успешно разморозили свой аккаунт *${player.display_name}*. Теперь вы снова можете входить на сервер.`
      : `🔥 *АККАУНТ РАЗМОРОЖЕН АДМИНАМИ*\n\nИгрок: *${player.display_name}*`;

    await ctx.replyWithMarkdown(message);
  });

  // 3. /mc_kick [player] [reason]
  bot.command('mc_kick', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const inputPlayer = parts[1] && !parts[1].startsWith('/') ? parts[1].trim() : null;
    const reason = inputPlayer ? (parts.slice(2).join(' ') || 'Кикнут через Telegram') : 'Кик по запросу владельца через Telegram';

    const res = resolveTargetPlayer(ctx, inputPlayer);
    if (res.error) {
      return ctx.replyWithMarkdown(res.error);
    }

    sendCommandToPlugin('KICK_PLAYER', { username: res.targetUsername, reason });

    const message = res.isSelf
      ? `👢 *КОМАНДА КИКА ОТПРАВЛЕНА*\n\nЗапрос на кик вашего аккаунта *${res.targetUsername}* отправлен на сервер.`
      : `👢 *КОМАНДА КИКА ОТПРАВЛЕНА АДМИНОМ*\n\nИгрок: *${res.targetUsername}*\nПричина: _${reason}_`;

    await ctx.replyWithMarkdown(message);
  });

  // 4. /mc_changepass <newpassword> [player]
  bot.command('mc_changepass', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.replyWithMarkdown('⚠️ *Использование:* `/mc_changepass <новый_пароль> [никнейм_для_админов]`');
    }

    const newPassword = parts[1].trim();
    const inputPlayer = parts[2] ? parts[2].trim() : null;

    const res = resolveTargetPlayer(ctx, inputPlayer);
    if (res.error) {
      return ctx.replyWithMarkdown(res.error);
    }

    const newHash = hashPassword(newPassword);
    res.player.password_hash = newHash;
    tgDb.saveAuthPlayer(res.player);

    sendCommandToPlugin('CHANGE_PASS', { username: res.targetUsername, newPasswordHash: newHash });

    const message = res.isSelf
      ? `🔑 *ВАШ ПАРОЛЬ УСПЕШНО ИЗМЕНЕН*\n\nПароль от вашего аккаунта *${res.targetUsername}* был обновлен.`
      : `🔑 *ПАРОЛЬ ИГРОКА ИЗМЕНЕН АДМИНОМ*\n\nАккаунт: *${res.targetUsername}*`;

    await ctx.replyWithMarkdown(message);
  });

  // 5. /mc_userinfo [player]
  bot.command('mc_userinfo', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const inputPlayer = parts[1] ? parts[1].trim() : null;

    const res = resolveTargetPlayer(ctx, inputPlayer);
    if (res.error) {
      return ctx.replyWithMarkdown(res.error);
    }

    const player = res.player;

    const infoText = `📋 *ПРОФИЛЬ ИГРОКА MINECRAFT*\n\n` +
      `👤 *Никнейм:* \`${player.display_name || res.targetUsername}\`\n` +
      `🌐 *IP-Адрес:* \`${player.ip_address || '127.0.0.1'}\`\n` +
      `🛡️ *2FA Статус:* ${player.is_2fa_enabled ? '✅ Включена' : '❌ Отключена'}\n` +
      `❄️ *Заморозка:* ${player.is_frozen ? '❄️ Заморожен' : '🟢 Активен'}\n` +
      `📅 *Регистрация:* ${new Date(player.registration_date || Date.now()).toLocaleString('ru-RU')}`;

    await ctx.replyWithMarkdown(infoText);
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
      `Игроки могут управлять своим аккаунтом (`/mc_kick`, `/mc_freeze`, `/mc_unfreeze`, `/mc_changepass`).\n` +
      `Администраторы могут управлять другими игроками.`;

    await ctx.replyWithMarkdown(adminText);
  });
}
