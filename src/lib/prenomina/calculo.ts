/**
 * Cálculo de prenómina: agrega fichajes + ausencias del periodo y
 * aplica las reglas configurables del tenant (horas extra, plus
 * nocturnidad, plus festivos) para producir el snapshot que se
 * persiste en la tabla `Prenomina`.
 *
 * Función pura sobre datos ya cargados — no toca BD. Los callers
 * (endpoints) hacen el findMany de Fichaje/Ausencia y le pasan
 * los datos. Esto facilita tests y permite recalcular sin re-query.
 */

import { TipoFichaje } from "@/generated/prisma-tenant/client";

export interface ReglasNomina {
  jornadaSemanal: number; // horas/semana base (default 40)
  horaExtraFactor: number; // multiplicador (default 1.75)
  plusNocturnidadActivo: boolean;
  nocturnidadDesde: string; // "HH:MM" (default "22:00")
  nocturnidadHasta: string; // "HH:MM" (default "06:00")
  plusNocturnidadFactor: number; // multiplicador (default 1.25)
  plusFestivoActivo: boolean;
  plusFestivoFactor: number; // multiplicador (default 1.75)
  salarioBaseDefault: number; // €/mes (default 0)
  moneda: string; // "EUR"
}

export interface FichajeInput {
  userId: string;
  tipo: TipoFichaje;
  timestamp: Date;
}

export interface AusenciaInput {
  userId: string;
  fechaInicio: Date;
  fechaFin: Date;
  pagada: boolean;
}

export interface Festivo {
  fecha: Date; // ISO date
}

export interface CalculoEmpleado {
  empleadoId: string;
  horasTrabajadas: number; // total horas (suma de sesiones)
  horasOrdinarias: number; // = horasTrabajadas - horasExtras
  horasExtras: number; // por encima del umbral mensual
  horasNocturnas: number; // dentro de la franja nocturna
  horasFestivas: number; // trabajadas en festivos
  diasTrabajados: number;
  diasAusenciaPagada: number;
  diasAusenciaNoPagada: number;
  importeHorasExtras: number;
  importeNocturnidad: number;
  importeFestivos: number;
  totalCalculado: number; // suma de importes (sin conceptos manuales ni salario base)
}

/**
 * Convierte "HH:MM" en minutos desde medianoche (0..1440).
 */
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Calcula los minutos de un intervalo [start, end] que caen dentro
 * de la franja nocturna [desde, hasta] (que puede cruzar medianoche).
 */
function minutosEnFranja(
  start: Date,
  end: Date,
  desdeMin: number,
  hastaMin: number,
): number {
  if (end <= start) return 0;
  let total = 0;
  // Iteramos por días naturales del intervalo (en UTC para evitar TZ).
  // El intervalo nocturno por día se calcula respecto a la jornada
  // local del día. Para simplificar usamos UTC consistentemente.
  const dayMs = 86_400_000;
  let cursor = new Date(start);
  while (cursor < end) {
    const dayStart = new Date(
      Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
      ),
    );
    const nextDay = new Date(dayStart.getTime() + dayMs);
    // La franja nocturna del día puede cruzar medianoche: [desdeMin..1440)
    // + [0..hastaMin] del DÍA SIGUIENTE. Cuando hasta < desde la franja
    // arranca a "desde" y termina a "hasta" del día siguiente.
    const ranges: Array<[Date, Date]> = [];
    if (hastaMin > desdeMin) {
      // Franja simple del mismo día (ej. 14:00-18:00).
      ranges.push([
        new Date(dayStart.getTime() + desdeMin * 60_000),
        new Date(dayStart.getTime() + hastaMin * 60_000),
      ]);
    } else {
      // Franja nocturna típica 22:00 → 06:00 al día siguiente.
      ranges.push([
        new Date(dayStart.getTime() + desdeMin * 60_000),
        nextDay,
      ]);
      ranges.push([
        dayStart,
        new Date(dayStart.getTime() + hastaMin * 60_000),
      ]);
    }
    for (const [rStart, rEnd] of ranges) {
      const s = new Date(Math.max(rStart.getTime(), start.getTime()));
      const e = new Date(Math.min(rEnd.getTime(), end.getTime()));
      if (e > s) total += (e.getTime() - s.getTime()) / 60_000;
    }
    cursor = nextDay;
  }
  return total;
}

/**
 * Reproduce el algoritmo del endpoint /api/prenomina pero devolviendo
 * el desglose completo (horas ordinarias / extras / nocturnas / festivas).
 *
 * @param empleadosIds   ids a calcular (typically activos del tenant)
 * @param fichajes       ordenados por userId asc, timestamp asc
 * @param ausencias      aprobadas del periodo (con `pagada` resuelta)
 * @param festivos       fechas festivas que caen en el periodo
 * @param reglas         reglas de cálculo del tenant
 * @param inicio/fin     límites del periodo (UTC)
 * @param horasTeoricasMes umbral por encima del cual cuenta extra
 */
export function calcularPrenomina(
  empleadosIds: string[],
  fichajes: FichajeInput[],
  ausencias: AusenciaInput[],
  festivos: Festivo[],
  reglas: ReglasNomina,
  inicio: Date,
  fin: Date,
  horasTeoricasMes: number,
): Map<string, CalculoEmpleado> {
  const resultado = new Map<string, CalculoEmpleado>();
  for (const uid of empleadosIds) {
    resultado.set(uid, {
      empleadoId: uid,
      horasTrabajadas: 0,
      horasOrdinarias: 0,
      horasExtras: 0,
      horasNocturnas: 0,
      horasFestivas: 0,
      diasTrabajados: 0,
      diasAusenciaPagada: 0,
      diasAusenciaNoPagada: 0,
      importeHorasExtras: 0,
      importeNocturnidad: 0,
      importeFestivos: 0,
      totalCalculado: 0,
    });
  }

  const desdeMin = hhmmToMinutes(reglas.nocturnidadDesde);
  const hastaMin = hhmmToMinutes(reglas.nocturnidadHasta);
  const festivosSet = new Set(
    festivos.map((f) => f.fecha.toISOString().slice(0, 10)),
  );

  // Pareo de fichajes en sesiones por usuario.
  const diasPorUser = new Map<string, Set<string>>();
  let activoDesde: Date | null = null;
  let pausaDesde: Date | null = null;
  let pausaAcumMs = 0;
  let lastUid: string | null = null;
  const sesiones: Array<{ uid: string; start: Date; end: Date }> = [];

  const cerrar = (uid: string, hasta: Date) => {
    if (!activoDesde) return;
    const realEnd = new Date(hasta.getTime() - pausaAcumMs);
    if (realEnd > activoDesde) {
      sesiones.push({ uid, start: activoDesde, end: realEnd });
      const set = diasPorUser.get(uid) ?? new Set<string>();
      set.add(activoDesde.toISOString().slice(0, 10));
      diasPorUser.set(uid, set);
    }
    activoDesde = null;
    pausaDesde = null;
    pausaAcumMs = 0;
  };

  for (const f of fichajes) {
    if (lastUid !== null && lastUid !== f.userId) {
      if (activoDesde) cerrar(lastUid, fin);
    }
    lastUid = f.userId;
    if (f.tipo === TipoFichaje.ENTRADA) {
      activoDesde = f.timestamp;
      pausaAcumMs = 0;
      pausaDesde = null;
    } else if (f.tipo === TipoFichaje.PAUSA) {
      pausaDesde = f.timestamp;
    } else if (f.tipo === TipoFichaje.VUELTA_PAUSA) {
      if (pausaDesde) {
        pausaAcumMs += f.timestamp.getTime() - pausaDesde.getTime();
        pausaDesde = null;
      }
    } else if (f.tipo === TipoFichaje.SALIDA) {
      if (pausaDesde) {
        pausaAcumMs += f.timestamp.getTime() - pausaDesde.getTime();
        pausaDesde = null;
      }
      cerrar(f.userId, f.timestamp);
    }
  }
  if (lastUid && activoDesde) cerrar(lastUid, fin);

  // Acumular por empleado, separando ordinaria/nocturna/festiva.
  for (const s of sesiones) {
    const acc = resultado.get(s.uid);
    if (!acc) continue;
    const totalMin = (s.end.getTime() - s.start.getTime()) / 60_000;
    acc.horasTrabajadas += totalMin / 60;

    if (reglas.plusNocturnidadActivo) {
      const nocMin = minutosEnFranja(s.start, s.end, desdeMin, hastaMin);
      acc.horasNocturnas += nocMin / 60;
    }
    if (reglas.plusFestivoActivo) {
      // Si el día (UTC) de inicio está en festivos, contar todas las
      // horas como festivas. Aproximación: la mayoría de turnos cabe
      // en un solo día calendario.
      const diaStart = s.start.toISOString().slice(0, 10);
      const diaEnd = s.end.toISOString().slice(0, 10);
      if (festivosSet.has(diaStart) || festivosSet.has(diaEnd)) {
        acc.horasFestivas += totalMin / 60;
      }
    }
  }
  for (const [uid, set] of diasPorUser) {
    const acc = resultado.get(uid);
    if (acc) acc.diasTrabajados = set.size;
  }

  // Ausencias: dividir en pagada vs no pagada en días.
  for (const a of ausencias) {
    if (a.fechaFin < inicio || a.fechaInicio > fin) continue;
    const s = a.fechaInicio < inicio ? inicio : a.fechaInicio;
    const e = a.fechaFin > fin ? fin : a.fechaFin;
    const dias = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
    const acc = resultado.get(a.userId);
    if (!acc) continue;
    if (a.pagada) acc.diasAusenciaPagada += dias;
    else acc.diasAusenciaNoPagada += dias;
  }

  // Horas extra: por encima de horasTeoricasMes.
  for (const acc of resultado.values()) {
    acc.horasExtras = Math.max(0, acc.horasTrabajadas - horasTeoricasMes);
    acc.horasOrdinarias = acc.horasTrabajadas - acc.horasExtras;

    // Importes derivados: requieren salario base / hora.
    // Aquí solo dejamos los multiplicadores aplicados a 0 (los importes
    // se rellenan en el endpoint con el salarioBase específico del
    // empleado). El cálculo de "importe / hora" lo hace el caller
    // porque cada empleado puede tener salario distinto en el futuro;
    // hoy usamos el default del tenant.

    // Redondeo a 2 decimales.
    acc.horasTrabajadas = Math.round(acc.horasTrabajadas * 100) / 100;
    acc.horasOrdinarias = Math.round(acc.horasOrdinarias * 100) / 100;
    acc.horasExtras = Math.round(acc.horasExtras * 100) / 100;
    acc.horasNocturnas = Math.round(acc.horasNocturnas * 100) / 100;
    acc.horasFestivas = Math.round(acc.horasFestivas * 100) / 100;
  }

  return resultado;
}

/**
 * Devuelve €/hora a partir de un salario base mensual + horas
 * teóricas del mes.
 */
export function precioHora(salarioBase: number, horasTeoricasMes: number): number {
  if (horasTeoricasMes <= 0) return 0;
  return salarioBase / horasTeoricasMes;
}

/**
 * Aplica los multiplicadores a un cálculo ya hecho, dado el salario
 * base mensual del empleado y las horas teóricas del mes. Muta `c`.
 */
export function aplicarImportes(
  c: CalculoEmpleado,
  salarioBase: number,
  horasTeoricasMes: number,
  reglas: ReglasNomina,
): void {
  const ph = precioHora(salarioBase, horasTeoricasMes);
  c.importeHorasExtras = Math.round(c.horasExtras * ph * reglas.horaExtraFactor * 100) / 100;
  c.importeNocturnidad = reglas.plusNocturnidadActivo
    ? Math.round(c.horasNocturnas * ph * (reglas.plusNocturnidadFactor - 1) * 100) / 100
    : 0;
  c.importeFestivos = reglas.plusFestivoActivo
    ? Math.round(c.horasFestivas * ph * (reglas.plusFestivoFactor - 1) * 100) / 100
    : 0;
  c.totalCalculado =
    Math.round(
      (salarioBase + c.importeHorasExtras + c.importeNocturnidad + c.importeFestivos) * 100,
    ) / 100;
}
