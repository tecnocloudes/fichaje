/**
 * Layouts de exportación de prenómina para distintos gestores
 * laborales españoles.
 *
 * - `generico`: una fila por empleado con todas las cifras agregadas.
 *   Pensado para que el gestor lo abra en Excel y trabaje sobre él.
 * - `sage`: layout Sage Despachos / Sage 200. Una fila por
 *   "movimiento" (concepto), tal y como Sage espera los CSV de
 *   importación masiva: CodEmpresa,CodCentro,CodEmpleado,DNI,
 *   CodConcepto,Fecha,Unidades,Importe,Descripcion.
 * - `a3`: layout A3NOM (Wolters Kluwer). Similar a Sage pero con sus
 *   propios códigos de concepto. Una fila por movimiento.
 *
 * Los códigos numéricos son los más comunes en plantillas de Sage/A3,
 * pero cada gestoría los redefine — el gestor laboral hace un mapeo
 * rápido al importar. El layout y la estructura son los que cuentan.
 */

export type Gestor = "generico" | "sage" | "a3";

export interface PrenominaParaExport {
  empleado: {
    id: string;
    dni: string | null;
    nombre: string;
    apellidos: string;
    email: string;
  };
  periodo: string; // YYYY-MM
  estado: string;
  diasTrabajados: number;
  horasTrabajadas: number;
  horasOrdinarias: number;
  horasExtras: number;
  horasNocturnas: number;
  horasFestivas: number;
  diasAusenciaPagada: number;
  diasAusenciaNoPagada: number;
  salarioBase: number;
  importeHorasExtras: number;
  importeNocturnidad: number;
  importeFestivos: number;
  importeConceptos: number;
  totalBruto: number;
  moneda: string;
  conceptos: {
    tipo: string;
    descripcion: string;
    cantidad: number | null;
    importe: number;
  }[];
}

export interface ExportTable {
  headers: string[];
  rows: (string | number)[][];
  /** Nombre sugerido para el archivo, sin extensión. */
  filename: string;
}

const ULTIMO_DIA = (periodo: string): string => {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${d.getUTCDate().toString().padStart(2, "0")}/${m.toString().padStart(2, "0")}/${y}`;
};

const CODIGOS_SAGE = {
  salarioBase: "001",
  horasExtras: "010",
  nocturnidad: "011",
  festividad: "012",
  DIETA: "040",
  KILOMETRAJE: "041",
  COMISION: "020",
  PLUS: "030",
  BONUS: "050",
  DEDUCCION: "099",
  OTRO: "098",
} as const;

const CODIGOS_A3 = {
  salarioBase: "1",
  horasExtras: "2",
  nocturnidad: "3",
  festividad: "4",
  DIETA: "21",
  KILOMETRAJE: "22",
  COMISION: "11",
  PLUS: "12",
  BONUS: "15",
  DEDUCCION: "90",
  OTRO: "99",
} as const;

function codigoConcepto(
  catalogo: typeof CODIGOS_SAGE | typeof CODIGOS_A3,
  tipo: string,
): string {
  return (catalogo as Record<string, string>)[tipo] ?? catalogo.OTRO;
}

/**
 * Layout genérico: una fila por empleado con cifras agregadas.
 */
function buildGenerico(prenominas: PrenominaParaExport[], periodo: string): ExportTable {
  const headers = [
    "DNI",
    "Apellidos",
    "Nombre",
    "Email",
    "Estado",
    "Días trabajados",
    "Horas totales",
    "Horas ordinarias",
    "Horas extras",
    "Horas nocturnas",
    "Horas festivas",
    "Días aus. pagada",
    "Días aus. no pagada",
    "Salario base",
    "Importe extras",
    "Importe nocturnidad",
    "Importe festivos",
    "Importe conceptos",
    "Total bruto",
    "Moneda",
  ];
  const rows = prenominas.map((p) => [
    p.empleado.dni ?? "",
    p.empleado.apellidos,
    p.empleado.nombre,
    p.empleado.email,
    p.estado,
    p.diasTrabajados,
    p.horasTrabajadas,
    p.horasOrdinarias,
    p.horasExtras,
    p.horasNocturnas,
    p.horasFestivas,
    p.diasAusenciaPagada,
    p.diasAusenciaNoPagada,
    p.salarioBase,
    p.importeHorasExtras,
    p.importeNocturnidad,
    p.importeFestivos,
    p.importeConceptos,
    p.totalBruto,
    p.moneda,
  ]);
  return { headers, rows, filename: `prenomina_${periodo}` };
}

/**
 * Layout movimientos: una fila por concepto incurrido. Lo usan tanto
 * Sage como A3 con códigos distintos. La fecha es la del último día
 * natural del periodo.
 */
function buildMovimientos(
  prenominas: PrenominaParaExport[],
  periodo: string,
  catalogo: typeof CODIGOS_SAGE | typeof CODIGOS_A3,
  prefijoEmpleado: string,
  filename: string,
): ExportTable {
  const fecha = ULTIMO_DIA(periodo);
  const headers = [
    "CodEmpresa",
    "CodCentro",
    "CodEmpleado",
    "DNI",
    "CodConcepto",
    "Fecha",
    "Unidades",
    "Importe",
    "Descripcion",
  ];
  const rows: (string | number)[][] = [];
  for (const p of prenominas) {
    const codEmpleado = `${prefijoEmpleado}${p.empleado.id.slice(-6).toUpperCase()}`;
    const dni = p.empleado.dni ?? "";
    const push = (cod: string, unidades: number, importe: number, desc: string) => {
      if (importe === 0 && unidades === 0) return;
      rows.push(["", "", codEmpleado, dni, cod, fecha, unidades, importe, desc]);
    };
    push(catalogo.salarioBase, 1, p.salarioBase, "Salario base");
    push(catalogo.horasExtras, p.horasExtras, p.importeHorasExtras, "Horas extras");
    push(catalogo.nocturnidad, p.horasNocturnas, p.importeNocturnidad, "Plus nocturnidad");
    push(catalogo.festividad, p.horasFestivas, p.importeFestivos, "Plus festividad");
    for (const c of p.conceptos) {
      const cod = codigoConcepto(catalogo, c.tipo);
      push(cod, c.cantidad ?? 1, c.importe, `${c.tipo}: ${c.descripcion}`);
    }
  }
  return { headers, rows, filename };
}

export function buildExportTable(
  prenominas: PrenominaParaExport[],
  periodo: string,
  gestor: Gestor,
): ExportTable {
  if (gestor === "sage") {
    return buildMovimientos(prenominas, periodo, CODIGOS_SAGE, "EMP", `prenomina_${periodo}_sage`);
  }
  if (gestor === "a3") {
    return buildMovimientos(prenominas, periodo, CODIGOS_A3, "E", `prenomina_${periodo}_a3`);
  }
  return buildGenerico(prenominas, periodo);
}

export function tableToCsv(table: ExportTable, sep: string = ","): string {
  const escape = (cell: string | number) => {
    const s = String(cell ?? "");
    if (s.includes(sep) || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [table.headers.map(escape).join(sep)];
  for (const row of table.rows) {
    lines.push(row.map(escape).join(sep));
  }
  // BOM + CRLF para que Excel español lo lea bien.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
