'use strict';

const MAX_FRAGMENT_LENGTH = 120;

function ucieknijRegex(value) {
  const tekst = String(value ?? '');
  if (tekst.length > MAX_FRAGMENT_LENGTH) {
    throw new RangeError(`Fragment regex przekracza limit ${MAX_FRAGMENT_LENGTH} znaków`);
  }
  return tekst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function utworzRegexPelnejNazwy(value) {
  const fragment = ucieknijRegex(value);
  if (!fragment) return /(?!) /u;
  return new RegExp(`(?<![\\p{L}\\p{N}_])${fragment}(?![\\p{L}\\p{N}_])`, 'iu');
}

module.exports = { ucieknijRegex, utworzRegexPelnejNazwy, MAX_FRAGMENT_LENGTH };
