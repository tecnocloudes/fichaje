import { describe, it, expect } from "vitest";
import {
  validateImagePayload,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_MIMES,
} from "./validate";

describe("validateImagePayload", () => {
  it("acepta null/undefined/'' (reset)", () => {
    expect(validateImagePayload(null, "logo").ok).toBe(true);
    expect(validateImagePayload(undefined, "logo").ok).toBe(true);
    expect(validateImagePayload("", "logo").ok).toBe(true);
  });

  it("acepta data URL png/jpeg/webp/svg/x-icon", () => {
    for (const mime of ALLOWED_IMAGE_MIMES) {
      const url = `data:image/${mime};base64,iVBORw0KGgo=`;
      expect(validateImagePayload(url, "logo").ok).toBe(true);
    }
    // Variante x-icon vendor-prefixed
    expect(
      validateImagePayload(
        "data:image/vnd.microsoft.icon;base64,AA==",
        "favicon",
      ).ok,
    ).toBe(true);
  });

  it("rechaza string que no sea data URL", () => {
    const r = validateImagePayload("https://x.com/logo.png", "logo");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("image_format_invalid");
  });

  it("rechaza data URL con MIME no permitido (gif)", () => {
    const r = validateImagePayload(
      "data:image/gif;base64,R0lGODlh",
      "logo",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.status).toBe(400);
  });

  it("rechaza non-string (number, object)", () => {
    expect(validateImagePayload(123, "logo").ok).toBe(false);
    expect(validateImagePayload({ url: "x" }, "logo").ok).toBe(false);
  });

  it("rechaza imagen > 3MB (cap)", () => {
    const huge = "data:image/png;base64," + "A".repeat(MAX_IMAGE_BYTES * 2);
    const r = validateImagePayload(huge, "favicon");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.status).toBe(413);
    expect(r.body.error).toBe("image_too_large");
  });
});
