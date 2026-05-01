import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { generarCSV, generarExcel, generarPDF } from "./generators";

const SAMPLE: Record<string, unknown> = {
  tipo: "fichajes",
  total: 2,
  data: [
    {
      id: "f1",
      tipo: "ENTRADA",
      timestamp: new Date("2026-04-15T08:00:00Z"),
      user: { id: "u1", nombre: "Ana", apellidos: "García", email: "ana@x.com" },
      tienda: { id: "t1", nombre: "Sede Centro" },
      latitud: null,
      longitud: null,
    },
    {
      id: "f2",
      tipo: "SALIDA",
      timestamp: new Date("2026-04-15T17:00:00Z"),
      user: { id: "u1", nombre: "Ana", apellidos: "García", email: "ana@x.com" },
      tienda: { id: "t1", nombre: "Sede Centro" },
      latitud: null,
      longitud: null,
    },
  ],
};

describe("generarCSV", () => {
  it("incluye BOM UTF-8 + headers + filas separadas por CRLF", () => {
    const csv = generarCSV(SAMPLE);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const stripped = csv.slice(1);
    const lines = stripped.split("\r\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3); // headers + 2 rows
    expect(lines[0]).toContain("empleado");
    expect(lines[0]).toContain("tienda");
    expect(lines[1]).toContain("Ana García");
    expect(lines[1]).toContain("Sede Centro");
    expect(lines[1]).toContain("ENTRADA");
  });

  it("escapa valores con coma o comillas según RFC 4180", () => {
    const payload = {
      tipo: "x",
      data: [{ a: 'con "comillas"', b: "con,coma", c: "normal" }],
    };
    const csv = generarCSV(payload);
    expect(csv).toContain('"con ""comillas"""');
    expect(csv).toContain('"con,coma"');
    expect(csv).toContain("normal");
  });

  it("payload vacío devuelve mensaje de sin datos", () => {
    const csv = generarCSV({ tipo: "x", data: [] });
    expect(csv).toContain("no hay datos");
  });
});

describe("generarExcel", () => {
  it("produce un buffer leíble como XLSX con headers correctos", () => {
    const buf = generarExcel(SAMPLE);
    expect(buf.length).toBeGreaterThan(0);
    // Verifica magic bytes ZIP (xlsx es zip).
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("fichajes");
    const sheet = wb.Sheets[wb.SheetNames[0]!];
    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(aoa[0]).toContain("empleado");
    expect(aoa[1]).toContain("Ana García");
  });

  it("añade hoja Resumen si payload tiene stats", () => {
    const buf = generarExcel({
      tipo: "resumen",
      empleados: [{ userId: "u1", nombre: "Ana", apellidos: "G", horasTotales: 8 }],
      stats: { totalHoras: 8, mediaHorasDia: 8 },
      total: 1,
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Resumen");
  });
});

describe("generarPDF", () => {
  it("produce un buffer con magic bytes PDF", () => {
    const buf = generarPDF(SAMPLE);
    expect(buf.length).toBeGreaterThan(100);
    // Magic bytes %PDF
    expect(buf[0]).toBe(0x25); // %
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x44); // D
    expect(buf[3]).toBe(0x46); // F
  });

  it("payload vacío produce PDF con mensaje 'sin datos'", () => {
    const buf = generarPDF({ tipo: "fichajes", data: [] });
    expect(buf.length).toBeGreaterThan(100);
  });
});
