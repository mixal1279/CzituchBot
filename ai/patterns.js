'use strict';

// Wspólne wzorce routingu. JS `\b` jest ASCII-only, więc nie działa z polskimi
// literami ("pogodził", "postać", "dziś"). Tutaj używamy lookaroundów Unicode.

// Rzeczowniki oznaczające czynność/zdarzenie w grze albo poza nią — pytanie
// "ile trwa <to>" nie dotyczy wtedy czasu przejścia całej gry (HowLongToBeat).
const NIE_CZAS_GRY = /(?<![\p{L}\p{N}_])(?:walk\p{L}*|fight\p{L}*|battle\p{L}*|combat\p{L}*|boss\p{L}*|bitw\p{L}*|misj\p{L}*|mission\p{L}*|quest\p{L}*|zadani\p{L}*|cutscen\p{L}*|cutscene\p{L}*|film\p{L}*|video\p{L}*|episode\p{L}*|dzie[ńn]|noc|cooldown\p{L}*|efekt\p{L}*|czar\p{L}*|animacj\p{L}*|wydarzeni\p{L}*|event\p{L}*|aktualizacj\p{L}*|update\p{L}*|instalacj\p{L}*|install\p{L}*|pobieran\p{L}*|download\p{L}*|serwer\p{L}*|server\p{L}*|proces\p{L}*|process\p{L}*|sezon\p{L}*|season\p{L}*|turniej\p{L}*|mecz\p{L}*|match\p{L}*|stream\p{L}*|odcink\p{L}*|poziom\p{L}*|level\p{L}*|respawn\p{L}*|ładowani\p{L}*|loading)(?![\p{L}\p{N}_])/iu;

module.exports = { NIE_CZAS_GRY };
