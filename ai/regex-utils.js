'use strict';

function ucieknijRegex(value) {
  return String(value ?? '').slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { ucieknijRegex };
