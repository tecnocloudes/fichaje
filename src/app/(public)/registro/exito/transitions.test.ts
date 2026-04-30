/**
 * Tests de la máquina de estados del polling de /registro/exito.
 *
 * Verifica que "unknown" NO dispara el branch error rojo (el bug que
 * el fix de este commit corrige), y que los umbrales (15 unknown
 * consecutivos, 30s slow, 5min timeout absoluto) se respetan.
 */

import { describe, it, expect } from "vitest";
import {
  decideNextState,
  decideOnFetchError,
  ABSOLUTE_TIMEOUT_MS,
  SLOW_AFTER_MS,
  UNKNOWN_SLOW_THRESHOLD,
} from "./transitions";

describe("decideNextState", () => {
  it("active → visual active, no más polling, devuelve slug", () => {
    const d = decideNextState(
      { status: "active", slug: "test1" },
      0,
      5000,
    );
    expect(d.visual).toBe("active");
    expect(d.continuePolling).toBe(false);
    expect(d.slug).toBe("test1");
  });

  it("pending temprano → waiting, polling sigue, streak reset", () => {
    const d = decideNextState({ status: "pending" }, 0, 1000);
    expect(d.visual).toBe("waiting");
    expect(d.continuePolling).toBe(true);
    expect(d.nextUnknownStreak).toBe(0);
  });

  it("provisioning temprano → waiting", () => {
    const d = decideNextState({ status: "provisioning" }, 0, 5000);
    expect(d.visual).toBe("waiting");
    expect(d.continuePolling).toBe(true);
  });

  it("provisioning > 30s → slow (sin error rojo)", () => {
    const d = decideNextState(
      { status: "provisioning" },
      0,
      SLOW_AFTER_MS + 1000,
    );
    expect(d.visual).toBe("slow");
    expect(d.continuePolling).toBe(true);
  });

  describe("unknown — bug corregido en este commit", () => {
    it("unknown solo NO dispara visual=error", () => {
      const d = decideNextState({ status: "unknown" }, 0, 2000);
      expect(d.visual).toBe("waiting");
      expect(d.visual).not.toBe("error");
      expect(d.continuePolling).toBe(true);
    });

    it("unknown incrementa el streak (1)", () => {
      const d = decideNextState({ status: "unknown" }, 0, 2000);
      expect(d.nextUnknownStreak).toBe(1);
    });

    it("unknown <15 consecutivos → visual=waiting (sin slow)", () => {
      const d = decideNextState({ status: "unknown" }, 14, 30000);
      // 14+1 = 15, llegará al umbral en este tick.
      expect(d.nextUnknownStreak).toBe(15);
      expect(d.visual).toBe("slow");
    });

    it(`${UNKNOWN_SLOW_THRESHOLD} unknown consecutivos → visual=slow`, () => {
      const d = decideNextState(
        { status: "unknown" },
        UNKNOWN_SLOW_THRESHOLD - 1,
        25000,
      );
      expect(d.nextUnknownStreak).toBe(UNKNOWN_SLOW_THRESHOLD);
      expect(d.visual).toBe("slow");
      expect(d.continuePolling).toBe(true);
    });

    it("unknown durante mucho tiempo NO dispara error mientras streak <15", () => {
      const d = decideNextState({ status: "unknown" }, 5, 100000);
      // 100s y streak=5, ya pasó SLOW_AFTER_MS pero el unknown branch
      // SOLO mira el streak, no el tiempo. Streak < 15 → waiting.
      expect(d.visual).toBe("waiting");
      expect(d.continuePolling).toBe(true);
    });

    it("active tras 20 unknown consecutivos → reset y redirect", () => {
      const d = decideNextState({ status: "active", slug: "test1" }, 20, 60000);
      expect(d.visual).toBe("active");
      expect(d.continuePolling).toBe(false);
      expect(d.nextUnknownStreak).toBe(0);
      expect(d.slug).toBe("test1");
    });

    it("pending tras unknown streak resetea streak", () => {
      const d = decideNextState({ status: "pending" }, 10, 25000);
      expect(d.nextUnknownStreak).toBe(0);
    });
  });

  describe("timeout absoluto 5 minutos", () => {
    it("elapsed > 5min → error terminal aunque sea active", () => {
      const d = decideNextState(
        { status: "active", slug: "x" },
        0,
        ABSOLUTE_TIMEOUT_MS + 1,
      );
      expect(d.visual).toBe("error");
      expect(d.continuePolling).toBe(false);
    });

    it("elapsed > 5min con unknown → error terminal", () => {
      const d = decideNextState(
        { status: "unknown" },
        5,
        ABSOLUTE_TIMEOUT_MS + 1,
      );
      expect(d.visual).toBe("error");
      expect(d.continuePolling).toBe(false);
    });

    it("elapsed = 5min - 1ms → todavía no error", () => {
      const d = decideNextState(
        { status: "unknown" },
        5,
        ABSOLUTE_TIMEOUT_MS - 1,
      );
      expect(d.visual).not.toBe("error");
      expect(d.continuePolling).toBe(true);
    });
  });
});

describe("decideOnFetchError", () => {
  it("siempre devuelve error terminal", () => {
    const d = decideOnFetchError();
    expect(d.visual).toBe("error");
    expect(d.continuePolling).toBe(false);
  });
});
