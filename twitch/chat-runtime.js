'use strict';

function normalizeTwitchChannel(value) {
  return String(value || '').trim().replace(/^#/, '').toLowerCase();
}

function getTwitchCommandName(message) {
  const match = String(message || '').trim().match(/^(![^\\s]+)/);
  return match ? match[1].toLowerCase() : '__message__';
}

function buildTwitchCommandCooldownKey({ channel, login, message }) {
  const normalizedChannel = normalizeTwitchChannel(channel) || 'unknown-channel';
  const normalizedLogin = String(login || '').trim().toLowerCase() || 'unknown-user';
  return `twitch:${normalizedChannel}:${normalizedLogin}:${getTwitchCommandName(message)}`;
}

function normalizeTwitchOAuthToken(token) {
  return String(token || '').trim().replace(/^oauth:/i, '');
}

function inspectTwitchChatToken(validation, {
  expectedLogin,
  expectedClientId,
  requiredScopes = ['chat:read'],
} = {}) {
  const errors = [];
  const login = String(validation?.login || '').trim().toLowerCase();
  const clientId = String(validation?.client_id || '').trim();
  const scopes = Array.isArray(validation?.scopes) ? validation.scopes : [];

  if (!validation || !login || !validation.user_id) {
    errors.push('Token nie jest tokenem użytkownika Twitch (brak login/user_id).');
  }
  if (expectedLogin && login !== String(expectedLogin).trim().toLowerCase()) {
    errors.push(`Token należy do konta ${login || 'nieznanego'}, a tmi.js loguje się jako ${String(expectedLogin).toLowerCase()}.`);
  }
  if (expectedClientId && clientId !== String(expectedClientId).trim()) {
    errors.push('Token został wydany dla innego Twitch Client ID niż skonfigurowany w bocie.');
  }

  const missingScopes = requiredScopes.filter(scope => !scopes.includes(scope));
  if (missingScopes.length) {
    errors.push(`Brak wymaganych scope OAuth: ${missingScopes.join(', ')}.`);
  }

  return { ok: errors.length === 0, errors, login, clientId, scopes: [...scopes], missingScopes };
}

function createTwitchJoinTracker(channels = []) {
  const expected = new Set(channels.map(normalizeTwitchChannel).filter(Boolean));
  const joined = new Set();

  return {
    connected() {
      joined.clear();
    },
    disconnected() {
      joined.clear();
    },
    markJoined(channel) {
      const normalized = normalizeTwitchChannel(channel);
      if (expected.has(normalized)) joined.add(normalized);
      return this.isReady();
    },
    markPart(channel) {
      joined.delete(normalizeTwitchChannel(channel));
      return this.missingChannels();
    },
    isReady() {
      return expected.size > 0 && [...expected].every(channel => joined.has(channel));
    },
    missingChannels() {
      return [...expected].filter(channel => !joined.has(channel));
    },
    joinedChannels() {
      return [...joined];
    },
  };
}

module.exports = {
  buildTwitchCommandCooldownKey,
  createTwitchJoinTracker,
  getTwitchCommandName,
  inspectTwitchChatToken,
  normalizeTwitchOAuthToken,
};
