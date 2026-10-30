'use strict';

// Groq Structured Outputs (strict) potrafi odrzucić wygenerowany JSON po stronie
// serwera (HTTP 400, code=json_validate_failed) i zwrócić go w polu
// `failed_generation`. Walidator ma własną, ścisłą weryfikację lokalną
// (źródło, cytat, negacje, liczby, pokrycie odpowiedzi), więc taki JSON nie jest
// stracony: oddajemy go dalej jako zwykłą odpowiedź, a lokalny kontrakt
// zdecyduje, czy przejdzie. Dotyczy wyłącznie żądań walidatora (json_schema
// o nazwie czituch_validator); generator nigdy nie jest ratowany w ten sposób.

const VALIDATOR_SCHEMA_NAME = 'czituch_validator';

function czyZadanieWalidatora(payload) {
  const format = payload?.response_format;
  return format?.type === 'json_schema' && format?.json_schema?.name === VALIDATOR_SCHEMA_NAME;
}

function czyBladWalidacjiJsonSchema(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const code = String(error?.code ?? error?.error?.code ?? '');
  const message = String(error?.message || '');
  return status === 400 && (code === 'json_validate_failed' || /json_validate_failed/.test(message));
}

// groq-sdk wkleja całe ciało odpowiedzi do message ("400 {"error":{...}}"),
// a pole failed_generation nie zawsze jest dostępne na obiekcie błędu.
function cialoZKomunikatu(message) {
  const text = String(message || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start)); } catch (_) { return null; }
}

function extractGroqFailedGeneration(error) {
  if (!error) return '';
  const body = cialoZKomunikatu(error.message);
  const candidates = [
    error.failed_generation,
    error.error?.failed_generation,
    error.error?.error?.failed_generation,
    error.response?.data?.error?.failed_generation,
    body?.error?.failed_generation,
    body?.failed_generation,
  ];
  const found = candidates.find(value => typeof value === 'string' && value.trim());
  return found ? found.trim() : '';
}

/**
 * Zwraca syntetyczne `chat.completion` z JSON-em z failed_generation albo null,
 * gdy błąd nie kwalifikuje się do uratowania (inny kod, inne żądanie, brak lub
 * ucięty JSON). Nic nie jest naprawiane ani uzupełniane na tym etapie.
 */
function salvageGroqJsonSchemaFailure(error, payload) {
  if (!czyZadanieWalidatora(payload) || !czyBladWalidacjiJsonSchema(error)) return null;
  const text = extractGroqFailedGeneration(error)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    id: 'local-failed-generation-salvage',
    object: 'chat.completion',
    model: String(payload?.model || ''),
    choices: [{
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(parsed) },
    }],
    usage: null,
    salvaged_failed_generation: true,
  };
}

module.exports = {
  VALIDATOR_SCHEMA_NAME,
  czyZadanieWalidatora,
  czyBladWalidacjiJsonSchema,
  extractGroqFailedGeneration,
  salvageGroqJsonSchemaFailure,
};
