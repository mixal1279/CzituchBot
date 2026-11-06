'use strict';

function czyBezpiecznaKwotaEko(kwota) {
  return typeof kwota === 'number' && Number.isSafeInteger(kwota) && kwota > 0;
}

module.exports = { czyBezpiecznaKwotaEko };
