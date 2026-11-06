'use strict';

const DEFAULT_CLOSE_TIMEOUT_MS = 3000;

function utworzLifecycle({ logger = console, closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS } = {}) {
  const zasoby = new Map();
  let zamykanie = false;
  let promiseZamykania = null;
  let handleryZainstalowane = false;

  function zarejestruj(nazwa, zamknij) {
    if (typeof zamknij !== 'function') throw new TypeError('Funkcja zamykania zasobu jest wymagana.');
    const id = Symbol(String(nazwa || 'zasob'));
    if (zamykanie) {
      Promise.resolve().then(zamknij).catch(error =>
        logger.warn?.('[Lifecycle] Nie udało się zamknąć późno zarejestrowanego zasobu:', nazwa, error?.message || error)
      );
      return () => {};
    }
    zasoby.set(id, { nazwa: String(nazwa || 'zasob'), zamknij });
    return () => zasoby.delete(id);
  }

  async function wykonajZTimeoutem(nazwa, zamknij) {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(zamknij),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), closeTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      logger.warn?.(`[Lifecycle] Problem przy zamykaniu ${nazwa}: ${error?.message || error}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function zamknijWszystko(powod = 'shutdown') {
    if (promiseZamykania) return promiseZamykania;
    zamykanie = true;
    promiseZamykania = (async () => {
      logger.info?.(`[Lifecycle] Rozpoczynam zamykanie (${powod}); zasobów: ${zasoby.size}.`);
      const wpisy = [...zasoby.values()].reverse();
      zasoby.clear();
      for (const { nazwa, zamknij } of wpisy) {
        await wykonajZTimeoutem(nazwa, zamknij);
      }
      logger.info?.('[Lifecycle] Zamykanie zasobów zakończone.');
    })();
    return promiseZamykania;
  }

  function zarejestrujWebSocket(socket, nazwa = 'WebSocket') {
    if (!socket || typeof socket.close !== 'function' || socket.readyState === 3) return () => {};
    let zakonczono = false;
    const wyrejestruj = zarejestruj(nazwa, async () => {
      if (zakonczono) return;
      zakonczono = true;
      const gotowy = socket.readyState;
      // WebSocket.OPEN=1, CONNECTING=0, CLOSING=2, CLOSED=3.
      if (gotowy === 3) return;
      await new Promise(resolve => {
        let timer;
        const zakoncz = () => {
          if (timer) clearTimeout(timer);
          socket.removeListener?.('close', zakoncz);
          resolve();
        };
        socket.once?.('close', zakoncz);
        timer = setTimeout(() => {
          try { socket.terminate?.(); } catch (_) {}
          zakoncz();
        }, Math.min(closeTimeoutMs, 1500));
        timer.unref?.();
        try { socket.close(1001, 'Server shutdown'); }
        catch (_) { zakoncz(); }
      });
    });
    socket.once?.('close', () => {
      zakonczono = true;
      wyrejestruj();
    });
    return wyrejestruj;
  }

  function zainstalujObslugeProcesu(proc = process, exitFn = code => process.exit(code)) {
    if (handleryZainstalowane) return;
    handleryZainstalowane = true;
    let wymuszenie = null;

    const zakonczProces = (kod, powod) => {
      if (wymuszenie) return;
      wymuszenie = setTimeout(() => {
        logger.error?.('[Lifecycle] Przekroczono limit zamykania; wymuszam zakończenie procesu.');
        exitFn(kod || 1);
      }, 15000);
      wymuszenie.unref?.();
      void zamknijWszystko(powod).finally(() => {
        if (wymuszenie) clearTimeout(wymuszenie);
        wymuszenie = null;
        proc.exitCode = kod;
        exitFn(kod);
      });
    };

    proc.on('SIGTERM', () => zakonczProces(0, 'SIGTERM'));
    proc.on('SIGINT', () => zakonczProces(0, 'SIGINT'));
    proc.on('unhandledRejection', error => {
      logger.error?.('[Proces] Nieobsłużone odrzucenie Promise:', error?.stack || error);
      zakonczProces(1, 'unhandledRejection');
    });
    proc.on('uncaughtException', error => {
      logger.error?.('[Proces] Nieobsłużony wyjątek:', error?.stack || error);
      zakonczProces(1, 'uncaughtException');
    });
  }

  return {
    zarejestruj,
    zarejestrujWebSocket,
    zamknijWszystko,
    zainstalujObslugeProcesu,
    czyZamykanie: () => zamykanie,
    liczbaZasobow: () => zasoby.size,
  };
}

module.exports = { utworzLifecycle };
