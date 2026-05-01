import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectDeviceType, deviceFichajeFeature } from "./device";

type FakeNavigator = { userAgent: string; maxTouchPoints: number };
type FakeWindow = {
  innerWidth: number;
  matchMedia: (q: string) => { matches: boolean };
  addEventListener: () => void;
  removeEventListener: () => void;
};

function setupBrowser(opts: {
  ua: string;
  width: number;
  coarse: boolean;
  touchPoints: number;
}): void {
  const win: FakeWindow = {
    innerWidth: opts.width,
    matchMedia: (q: string) => ({
      matches: q.includes("coarse") ? opts.coarse : false,
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const nav: FakeNavigator = {
    userAgent: opts.ua,
    maxTouchPoints: opts.touchPoints,
  };
  (globalThis as Record<string, unknown>).window = win as unknown as Window;
  (globalThis as Record<string, unknown>).navigator = nav as unknown as Navigator;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).navigator;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).navigator;
});

describe("detectDeviceType", () => {
  it("SSR (sin window) → unknown", () => {
    expect(detectDeviceType()).toBe("unknown");
  });

  it("iPhone UA → mobile", () => {
    setupBrowser({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15",
      width: 390,
      coarse: true,
      touchPoints: 5,
    });
    expect(detectDeviceType()).toBe("mobile");
  });

  it("Android phone UA → mobile", () => {
    setupBrowser({
      ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobi",
      width: 412,
      coarse: true,
      touchPoints: 5,
    });
    expect(detectDeviceType()).toBe("mobile");
  });

  it("iPad UA clásico → tablet", () => {
    setupBrowser({
      ua: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)",
      width: 1024,
      coarse: true,
      touchPoints: 5,
    });
    expect(detectDeviceType()).toBe("tablet");
  });

  it("iPad moderno con UA Macintosh + touchpoints → tablet", () => {
    setupBrowser({
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15",
      width: 1024,
      coarse: true,
      touchPoints: 5,
    });
    expect(detectDeviceType()).toBe("tablet");
  });

  it("desktop con mouse fino → desktop", () => {
    setupBrowser({
      ua: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120",
      width: 1920,
      coarse: false,
      touchPoints: 0,
    });
    expect(detectDeviceType()).toBe("desktop");
  });

  it("Mac sin touchpoints → desktop", () => {
    setupBrowser({
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15",
      width: 1440,
      coarse: false,
      touchPoints: 0,
    });
    expect(detectDeviceType()).toBe("desktop");
  });
});

describe("deviceFichajeFeature", () => {
  it("mapea cada device a su feature key", () => {
    expect(deviceFichajeFeature("mobile")).toBe("fichaje_movil");
    expect(deviceFichajeFeature("tablet")).toBe("fichaje_tablet");
    expect(deviceFichajeFeature("desktop")).toBeNull();
    expect(deviceFichajeFeature("unknown")).toBeNull();
  });
});
