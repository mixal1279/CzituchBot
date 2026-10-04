/**
 * trello.js – integracja z Trello (Tablica Buły)
 *
 * Świadomie ograniczony zakres: moduł umie WYŁĄCZNIE tworzyć nowe karty.
 * Brak funkcji DELETE / PUT (edycja) – nic nie rusza na istniejącej tablicy.
 *
 * Zmienne .env:
 *   TRELLO_API_KEY   – klucz API
 *   TRELLO_TOKEN     – token dostępu
 *   TRELLO_BOARD_ID  – ID tablicy (informacyjnie, nieużywane bezpośrednio w POST /cards)
 *   TRELLO_LIST_ID   – ID listy, na którą trafiają nowe karty
 *   TRELLO_DRY_RUN   – 'true'/'false' – gdy true, tylko loguje bez realnego wywołania API
 */

const TRELLO_API_KEY  = process.env.TRELLO_API_KEY;
const TRELLO_TOKEN    = process.env.TRELLO_TOKEN;
const TRELLO_LIST_ID  = process.env.TRELLO_LIST_ID;

function czyDryRun() {
  // Sprawdzane przy każdym wywołaniu (nie raz przy starcie), żeby dało się
  // przełączyć w .env bez restartu bota jeśli kiedyś dojdzie hot-reload configu.
  return String(process.env.TRELLO_DRY_RUN).toLowerCase() === 'true';
}

/**
 * Tworzy nową kartę na Tablicy Buły.
 * @param {string} tytul - nazwa karty (np. nick widza + krótki opis zadania)
 * @param {string} opis  - opis karty (np. user_input z redemption)
 * @param {string} [idList] - opcjonalne ID listy Trello; jeśli podane, użyte zamiast domyślnego TRELLO_LIST_ID
 * @returns {Promise<{ok: boolean, id?: string}>}
 */
async function utworzKarteTrello(tytul, opis, idList = null) {
  const targetListId = idList || TRELLO_LIST_ID;

  if (!TRELLO_API_KEY || !TRELLO_TOKEN || !targetListId) {
    console.error('[Trello] ❌ Brak konfiguracji – sprawdź TRELLO_API_KEY / TRELLO_TOKEN / TRELLO_LIST_ID w .env');
    return { ok: false };
  }

  if (czyDryRun()) {
    console.log('[Trello] 🧪 DRY-RUN – karta NIE została wysłana. Wysłałbym:');
    console.log(`[Trello] 🧪   idList: ${targetListId}`);
    console.log(`[Trello] 🧪   name:   ${tytul}`);
    console.log(`[Trello] 🧪   desc:   ${opis || '(brak opisu)'}`);
    return { ok: true, id: null };
  }

  try {
    const params = new URLSearchParams({
      idList: targetListId,
      name:   tytul,
      desc:   opis || '',
      key:    TRELLO_API_KEY,
      token:  TRELLO_TOKEN,
    });

    const res = await fetch(`https://api.trello.com/1/cards?${params.toString()}`, {
      method: 'POST',
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[Trello] ✅ Karta utworzona: "${tytul}" (id: ${data.id})`);
      return { ok: true, id: data.id };
    }

    if (res.status === 401) {
      console.error('[Trello] ❌ HTTP 401 – token Trello stracił ważność lub jest błędny. Odnów TRELLO_TOKEN w .env.');
      return { ok: false };
    }

    const err = await res.text();
    console.error(`[Trello] ❌ HTTP ${res.status}:`, err);
    return { ok: false };
  } catch (err) {
    console.error('[Trello] ❌ Błąd fetch:', err.message);
    return { ok: false };
  }
}

module.exports = { utworzKarteTrello };