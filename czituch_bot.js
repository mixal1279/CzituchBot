/**
 * CzituchBot – Kick + Twitch + YouTube Live
 * npm install groq-sdk pusher-js tmi.js googleapis
 *
 * Uzupełnij sekcję KONFIGURACJA poniżej swoimi danymi
 */

const Pusher      = require('pusher-js');
const Groq        = require('groq-sdk');
const tmi         = require('tmi.js');
const { google }  = require('googleapis');
const fs          = require('fs');
const http        = require('http');
const readline    = require('readline');

// =============================================
//  KONFIGURACJA – uzupełnij swoje dane
// =============================================
const KONFIGURACJA = {

  // --- KICK ---
  kick: {
    clientId:     'TWOJ_KICK_CLIENT_ID',
    clientSecret: 'TWOJ_KICK_CLIENT_SECRET',
    redirectUri:  'http://localhost:3000/callback',
    kanal:        'twoj_kanal_kick',        // małymi literami
    botUser:      'twoje_konto_bota_kick',
    tokenFile:    './kick_token.json',
  },

  // --- TWITCH ---
  twitch: {
    kanal:       'twoj_kanal_twitch',       // małymi literami
    botUser:     'twoje_konto_bota_twitch',
    accessToken: 'oauth:TWOJ_TWITCH_TOKEN', // z twitchtokengenerator.com
  },

  // --- YOUTUBE ---
  youtube: {
    clientId:     'TWOJ_GOOGLE_CLIENT_ID',
    clientSecret: 'TWOJ_GOOGLE_CLIENT_SECRET',
    targetKanal:  'NazwaKanaluYouTube',
    botUser:      'TwojeKontoYouTube',
    tokenFile:    './youtube_token.json',
    pollInterval: 5000,
  },

  // --- WSPÓLNE ---
  groqKey:  'TWOJ_GROQ_KEY',
  itadKey:  'TWOJ_ITAD_KEY',
  cooldown: 5000,
};

// =============================================
//  INICJALIZACJA
// =============================================
const groq = new Groq({ apiKey: KONFIGURACJA.groqKey });
const historiaRozmowy    = {};
const ostatnieUzycie     = {};
const znaniUzytkownicyYT = new Set();

function czekaj(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================
//  FILTR BEZPIECZEŃSTWA
// =============================================
const CZARNA_LISTA = [
  /nigger/gi, /czarnuch/gi, /bambus/gi, /asfalt/gi, /ciapaty/gi,
  /pedał/gi,  /faggot/gi,  /ciota/gi,  /gejuch/gi, /lesba/gi, /tranny/gi,
  /retard/gi, /upośledzony/gi, /autystyk/gi, /mongoł/gi, /kaleka/gi,
  /pizda/gi,  /pizd/gi,
];

function filtrBezpieczenstwa(tekst) {
  return CZARNA_LISTA.reduce((t, r) => t.replace(r, '[niedozwolone słowo]'), tekst);
}

// =============================================
//  WSPÓLNA LOGIKA KOMEND
// =============================================
async function obslugaKomendy(nick, message, wyslijFn, platforma) {
  if (!nick || !message) return;

  const msgLower = message.toLowerCase().trim();
  const teraz    = Date.now();
  const klucz    = `${platforma}:${nick}`;

  if (ostatnieUzycie[klucz] && teraz - ostatnieUzycie[klucz] < KONFIGURACJA.cooldown) return;

  if (msgLower === '!kostka') {
    ostatnieUzycie[klucz] = teraz;
    const wynik = Math.floor(Math.random() * 6) + 1;
    return await wyslijFn(`@${nick} Rzuciłeś kostką: ${wynik}! 🎲`);
  }

  if (msgLower.startsWith('!pogoda ')) {
    ostatnieUzycie[klucz] = teraz;
    const miasto = message.slice(8).trim();
    const dane   = await pobierzPogode(miasto);
    return await wyslijFn(dane ? `@${nick} ${dane} 🌤️` : `@${nick} Nie znalazłem tego miasta.`);
  }

  if (msgLower.startsWith('!czituch cena ') || msgLower.startsWith('!czituch ile kosztuje ')) {
    ostatnieUzycie[klucz] = teraz;
    const nazwaGry = message.replace(/^!czituch (cena|ile kosztuje)\s+/i, '').trim();
    const wynik    = await sprawdzCeneSteam(nazwaGry);
    if (!wynik) return await wyslijFn(`@${nick} Nie znalazłem tej gry na Steam.`);
    let tekst = `Gra "${wynik.nazwa}" kosztuje ${wynik.cena}.`;
    const klucz2 = await sprawdzNajtanszyKluczITAD(wynik.appId);
    if (klucz2) tekst += ` Najtaniej (klucze): ${klucz2.cena} w ${klucz2.sklep}.`;
    return await wyslijFn(`@${nick} ${tekst} 🎮`);
  }

  if (msgLower.startsWith('!czituch ')) {
    const pytanie = message.replace(/^!czituch\s+/i, '').trim();
    if (!pytanie) return;
    ostatnieUzycie[klucz] = teraz;
    if (!historiaRozmowy[klucz]) historiaRozmowy[klucz] = [];

    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `Jesteś "Czituch-Botem" na ${platforma}. Odpowiadaj bardzo krótko (max 2 zdania), uprzejmie i po polsku.` },
          ...historiaRozmowy[klucz],
          { role: 'user', content: pytanie },
        ],
        temperature: 0.6,
        max_tokens:  100,
      });

      let odp = filtrBezpieczenstwa(response.choices[0].message.content.trim());
      historiaRozmowy[klucz].push(
        { role: 'user',      content: pytanie },
        { role: 'assistant', content: odp     },
      );
      if (historiaRozmowy[klucz].length > 4) historiaRozmowy[klucz] = historiaRozmowy[klucz].slice(-4);
      await wyslijFn(`@${nick} ${odp}`);
    } catch (err) {
      console.error(`[Groq/${platforma}] ❌`, err.message);
    }
  }
}

// =============================================
//  POGODA
// =============================================
async function pobierzPogode(miasto) {
  try {
    const res  = await fetch(`https://wttr.in/${encodeURIComponent(miasto)}?format=j1&lang=pl`);
    const data = await res.json();
    const temp = data.current_condition[0].temp_C;
    const opis = data.current_condition[0].lang_pl?.[0]?.value || data.current_condition[0].weatherDesc[0].value;
    return `W mieście ${miasto} jest ${temp}°C. Warunki: ${opis}.`;
  } catch { return null; }
}

// =============================================
//  STEAM
// =============================================
async function sprawdzCeneSteam(nazwaGry) {
  try {
    const s  = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(nazwaGry)}&l=polish&cc=PL`);
    const sd = await s.json();
    if (!sd.items?.length) return null;
    const appId = sd.items[0].id;
    const d     = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=PL&l=polish`);
    const dd    = await d.json();
    const info  = dd[appId].data;
    return { nazwa: info.name, appId, cena: info.is_free ? 'DARMOWA' : (info.price_overview?.final_formatted || 'Brak ceny') };
  } catch { return null; }
}

// =============================================
//  ITAD
// =============================================
async function sprawdzNajtanszyKluczITAD(appId) {
  try {
    const lr  = await fetch(`https://api.isthereanydeal.com/games/lookup/v1?key=${KONFIGURACJA.itadKey}&appid=${appId}`);
    const ld  = await lr.json();
    const gid = ld?.game?.id;
    if (!gid) return null;
    const pr  = await fetch(`https://api.isthereanydeal.com/games/prices/v2?key=${KONFIGURACJA.itadKey}&country=PL`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([gid]),
    });
    const pd   = await pr.json();
    const best = pd?.[0]?.deals?.sort((a, b) => a.price.amount - b.price.amount)[0];
    return best ? { sklep: best.shop.name, cena: best.price.amount.toFixed(2) + ' zł' } : null;
  } catch { return null; }
}

// =============================================
//  KICK
// =============================================
let kickAccessToken  = null;
let kickRefreshToken = null;
let kickKanalId      = null;
let pkceVerifier     = null;

function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString('base64url');
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('base64url');
}

function zapiszTokenKick(data) {
  fs.writeFileSync(KONFIGURACJA.kick.tokenFile, JSON.stringify(data, null, 2));
}

function wczytajTokenKick() {
  try {
    if (fs.existsSync(KONFIGURACJA.kick.tokenFile)) {
      const data       = JSON.parse(fs.readFileSync(KONFIGURACJA.kick.tokenFile, 'utf8'));
      kickAccessToken  = data.access_token;
      kickRefreshToken = data.refresh_token;
      console.log('[Kick Auth] ✅ Wczytano token z pliku');
      return true;
    }
  } catch (err) { console.error('[Kick Auth] Błąd:', err.message); }
  return false;
}

function czekajNaKodKick() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:3000');
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        if (url.searchParams.get('error')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>❌ Błąd. Zamknij kartę i spróbuj ponownie.</h2>');
          server.close(); reject(new Error('Odrzucono')); return;
        }
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h2>✅ Zalogowano! Możesz zamknąć tę kartę.</h2>');
          server.close(); resolve(code);
        }
      }
    });
    server.listen(3000, () => console.log('[Kick Auth] Serwer OAuth na porcie 3000...'));
    server.on('error', err => reject(new Error(err.message)));
    setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 5 * 60 * 1000);
  });
}

async function zalogujKick() {
  pkceVerifier        = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(pkceVerifier);
  const authUrl       = 'https://id.kick.com/oauth/authorize?' + new URLSearchParams({
    client_id: KONFIGURACJA.kick.clientId, redirect_uri: KONFIGURACJA.kick.redirectUri,
    response_type: 'code', scope: 'chat:write',
    code_challenge: codeChallenge, code_challenge_method: 'S256',
    state: generateCodeVerifier().slice(0, 16),
  });
  console.log('\n🔐 LOGOWANIE DO KICK\nOtwórz ten link w przeglądarce:\n');
  console.log(authUrl + '\n');
  const code = await czekajNaKodKick();
  const res  = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: KONFIGURACJA.kick.clientId,
      client_secret: KONFIGURACJA.kick.clientSecret, redirect_uri: KONFIGURACJA.kick.redirectUri,
      code_verifier: pkceVerifier, code,
    }),
  });
  if (!res.ok) throw new Error(`Kick OAuth HTTP ${res.status}`);
  const data = await res.json();
  kickAccessToken = data.access_token; kickRefreshToken = data.refresh_token;
  zapiszTokenKick(data);
  console.log('[Kick Auth] ✅ Zalogowano!');
}

async function odswiezTokenKick() {
  if (!kickRefreshToken) { await zalogujKick(); return; }
  try {
    const res = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: KONFIGURACJA.kick.clientId,
        client_secret: KONFIGURACJA.kick.clientSecret, refresh_token: kickRefreshToken,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    kickAccessToken = data.access_token;
    if (data.refresh_token) kickRefreshToken = data.refresh_token;
    zapiszTokenKick(data);
    setTimeout(odswiezTokenKick, (data.expires_in - 60) * 1000);
  } catch (err) {
    console.error('[Kick Auth] ❌ Błąd odświeżania:', err.message);
    setTimeout(odswiezTokenKick, 30000);
  }
}

async function kickApi(path, options = {}) {
  const res = await fetch(`https://api.kick.com${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${kickAccessToken}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (res.status === 401) await odswiezTokenKick();
  return res.json();
}

async function pobierzIdKanaluKick() {
  const slug = KONFIGURACJA.kick.kanal.toLowerCase();
  let data   = await kickApi(`/public/v1/channels?slug=${encodeURIComponent(slug)}`);
  let id     = data?.data?.[0]?.chatroom?.id;
  if (!id) { data = await kickApi(`/api/v2/channels/${encodeURIComponent(slug)}`); id = data?.chatroom?.id; }
  if (!id) throw new Error('Kick: Nie znaleziono chatroom.id');
  kickKanalId = id;
  console.log(`[Kick] ✅ Chatroom ID: ${kickKanalId}`);
}

async function wyslijKick(tekst) {
  try {
    await kickApi('/public/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ broadcaster_user_id: kickKanalId, content: tekst, type: 'user' }),
    });
  } catch (err) { console.error('[Kick] ❌', err.message); }
}

function startKick() {
  const pusher  = new Pusher('32cbd69e4b950bf97679', { cluster: 'us2', forceTLS: true });
  const channel = pusher.subscribe(`chatrooms.${kickKanalId}.v2`);
  channel.bind('App\\Events\\ChatMessageEvent', (data) => {
    const nick = data.sender?.username;
    if (nick === KONFIGURACJA.kick.botUser) return;
    obslugaKomendy(nick, data.content, wyslijKick, 'Kick').catch(console.error);
  });
  pusher.connection.bind('connected', () => console.log(`✅ [Kick] ONLINE na kanale ${KONFIGURACJA.kick.kanal}!`));
  pusher.connection.bind('error', err => console.error('[Kick] Błąd Pusher:', err));
}

// =============================================
//  TWITCH
// =============================================
function startTwitch() {
  const client = new tmi.Client({
    options:  { debug: false },
    identity: { username: KONFIGURACJA.twitch.botUser, password: KONFIGURACJA.twitch.accessToken },
    channels: [KONFIGURACJA.twitch.kanal],
  });

  client.connect()
    .then(() => console.log(`✅ [Twitch] ONLINE na kanale ${KONFIGURACJA.twitch.kanal}!`))
    .catch(err => console.error('[Twitch] ❌ Błąd połączenia:', err.message));

  client.on('message', (channel, tags, message, self) => {
    if (self) return;
    const nick       = tags['display-name'] || tags.username;
    const wyslijFn   = async (tekst) => {
      try { await client.say(channel, tekst); }
      catch (err) { console.error('[Twitch] ❌', err.message); }
    };
    obslugaKomendy(nick, message, wyslijFn, 'Twitch').catch(console.error);
  });

  client.on('disconnected', (reason) => {
    console.warn('[Twitch] ⚠️ Rozłączono:', reason, '— retry za 10s...');
    setTimeout(() => client.connect().catch(console.error), 10000);
  });
}

// =============================================
//  YOUTUBE
// =============================================
const oauth2Client = new google.auth.OAuth2(
  KONFIGURACJA.youtube.clientId,
  KONFIGURACJA.youtube.clientSecret,
  'urn:ietf:wg:oauth:2.0:oob'
);
const yt = google.youtube({ version: 'v3', auth: oauth2Client });
let liveChatId    = null;
let ytPageToken   = null;

function zapiszTokenYT(tokens) {
  fs.writeFileSync(KONFIGURACJA.youtube.tokenFile, JSON.stringify(tokens, null, 2));
}

function wczytajTokenYT() {
  try {
    if (fs.existsSync(KONFIGURACJA.youtube.tokenFile)) {
      oauth2Client.setCredentials(JSON.parse(fs.readFileSync(KONFIGURACJA.youtube.tokenFile, 'utf8')));
      console.log('[YT Auth] ✅ Wczytano token z pliku');
      return true;
    }
  } catch (err) { console.error('[YT Auth] Błąd:', err.message); }
  return false;
}

async function zalogujYouTube() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'],
    prompt: 'consent',
  });
  console.log('\n🔐 LOGOWANIE DO YOUTUBE\nOtwórz ten link:\n');
  console.log(authUrl);
  console.log('\nSkopiuj kod i wklej poniżej.\n');
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const kod = await new Promise(resolve => rl.question('➡️  Wklej kod: ', ans => { rl.close(); resolve(ans.trim()); }));
  const { tokens } = await oauth2Client.getToken(kod);
  oauth2Client.setCredentials(tokens);
  zapiszTokenYT(tokens);
  oauth2Client.on('tokens', (t) => {
    const cur = JSON.parse(fs.readFileSync(KONFIGURACJA.youtube.tokenFile, 'utf8'));
    zapiszTokenYT({ ...cur, ...t });
  });
  console.log('[YT Auth] ✅ Zalogowano!');
}

async function pobierzLiveChatId() {
  const searchRes = await yt.search.list({ part: ['snippet'], q: KONFIGURACJA.youtube.targetKanal, type: ['channel'], maxResults: 5 });
  const channels  = searchRes.data.items;
  if (!channels?.length) throw new Error(`Nie znaleziono kanału YT`);
  const channelId = (channels.find(c => c.snippet.title.toLowerCase() === KONFIGURACJA.youtube.targetKanal.toLowerCase()) || channels[0]).snippet.channelId;
  const streamRes = await yt.search.list({ part: ['snippet'], channelId, eventType: 'live', type: ['video'], maxResults: 1 });
  if (!streamRes.data.items?.length) throw new Error('Brak aktywnego streamu na YouTube');
  const videoId  = streamRes.data.items[0].id.videoId;
  const videoRes = await yt.videos.list({ part: ['liveStreamingDetails'], id: [videoId] });
  liveChatId     = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) throw new Error('Brak Live Chat ID');
  console.log(`[YouTube] ✅ Live Chat ID: ${liveChatId}`);
}

async function wyslijYouTube(tekst) {
  const t = tekst.length > 200 ? tekst.substring(0, 197) + '...' : tekst;
  try {
    await yt.liveChatMessages.insert({
      part: ['snippet'],
      requestBody: { snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: t } } },
    });
  } catch (err) { console.error('[YouTube] ❌', err.message); }
}

async function startYouTube() {
  while (true) {
    try {
      await pobierzLiveChatId();
      console.log('✅ [YouTube] ONLINE!');
      const res  = await yt.liveChatMessages.list({ liveChatId, part: ['snippet'] });
      ytPageToken = res.data.nextPageToken;

      while (true) {
        try {
          const r     = await yt.liveChatMessages.list({ liveChatId, part: ['snippet', 'authorDetails'], pageToken: ytPageToken });
          ytPageToken = r.data.nextPageToken;
          for (const item of r.data.items || []) {
            const nick    = item.authorDetails?.displayName;
            const message = item.snippet?.displayMessage;
            if (!nick || !message || nick.toLowerCase() === KONFIGURACJA.youtube.botUser.toLowerCase()) continue;
            if (!znaniUzytkownicyYT.has(nick)) {
              znaniUzytkownicyYT.add(nick);
              try {
                const r2 = await groq.chat.completions.create({
                  model: 'llama-3.3-70b-versatile',
                  messages: [
                    { role: 'system', content: 'Generuj krótkie wesołe powitanie dla nowego widza YouTube. Max 1 zdanie, po polsku.' },
                    { role: 'user',   content: `Przywitaj: ${nick}` },
                  ],
                  temperature: 0.9, max_tokens: 60,
                });
                await wyslijYouTube(`👋 ${filtrBezpieczenstwa(r2.choices[0].message.content.trim())}`);
              } catch { await wyslijYouTube(`👋 Witaj na czacie, @${nick}!`); }
            }
            await obslugaKomendy(nick, message, wyslijYouTube, 'YouTube');
          }
          if (!ytPageToken) { console.log('[YouTube] Stream zakończony.'); break; }
          await czekaj(KONFIGURACJA.youtube.pollInterval);
        } catch (err) { console.error('[YouTube] ❌ Pętla:', err.message); await czekaj(10000); }
      }

      liveChatId  = null;
      ytPageToken = null;
    } catch (err) {
      console.log(`[YouTube] Brak streamu: ${err.message}. Retry za 60s...`);
    }
    await czekaj(60000);
  }
}

// =============================================
//  START
// =============================================
(async () => {
  console.log('🚀 Uruchamiam CzituchBota (Kick + Twitch + YouTube)...\n');

  // KICK
  try {
    if (!wczytajTokenKick()) await zalogujKick();
    setTimeout(odswiezTokenKick, 55 * 60 * 1000);
    await pobierzIdKanaluKick();
    startKick();
  } catch (err) { console.error('❌ [Kick]:', err.message); }

  // TWITCH
  try { startTwitch(); }
  catch (err) { console.error('❌ [Twitch]:', err.message); }

  // YOUTUBE
  try {
    if (!wczytajTokenYT()) await zalogujYouTube();
    oauth2Client.on('tokens', (t) => {
      const cur = JSON.parse(fs.readFileSync(KONFIGURACJA.youtube.tokenFile, 'utf8'));
      zapiszTokenYT({ ...cur, ...t });
    });
    startYouTube();
  } catch (err) { console.error('❌ [YouTube]:', err.message); }

  console.log('\n🎉 Bot uruchomiony na wszystkich platformach!\n');
})();
