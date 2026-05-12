/**
 * GET /api/prenomina/exportar?periodo=YYYY-MM&formato=csv
 *
 * Exporta el resumen de prenominas del periodo en CSV (compatible
 * con Sage/A3) o XLSX. Las prenominas en BORRADOR se incluyen pero
 * con flag de estado para que el gestor sepa que no están cerradas.
 *
 * Feature: `prenomina` + (export_csv | export_excel). OWNER/MANAGER.
 */

import { auth } from "@/lib/auth";
import { prismaApp as prisma } from "@/lib/prisma";
import { Rol } from "@/generated/prisma-tenant/client";
import { type NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenant/with-tenant";
import { withFeature } from "@/lib/feature-guard/with-feature";

export const GET = withTenant(
  withFeature("prenomina", async (req: NextRequest) => {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const userRol = (session.user as { rol?: Rol }).rol;
    if (userRol !== Rol.OWNER && userRol !== Rol.MANAGER) {
      return NextResponse.json({ error: "Solo OWNER/MANAGER" }, { status: 403 });
    }

    const periodo = req.nextUrl.searchParams.get("periodo");
    const formato = (req.nextUrl.searchParams.get("formato") ?? "csv").toLowerCase();
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      return NextResponse.json({ error: "periodo requerido (YYYY-MM)" }, { status: 400 });
    }
    if (formato !== "csv" && formato !== "xlsx") {
      return NextResponse.json({ error: "formato debe ser csv o xlsx" }, { status: 400 });
    }

    const prenominas = await prisma.prenomina.findMany({
      where: { periodo },
      include: {
        empleado: {
          select: { id: true, nombre: true, apellidos: true, email: true, dni: true },
        },
        conceptos: true,
      },
      orderBy: { empleado: { apellidos: "asc" } },
    });

    if (prenominas.length === 0) {
      return NextResponse.json(
        { error: "No hay prenominas para el periodo. Calcula primero." },
        { status: 404 },
      );
    }

    const filename = `prenomina_${periodo}.${formato === "csv" ? "csv" : "xlsx"}`;

    if (formato === "csv") {
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
        "Días ausencia pagada",
        "Días ausencia no pagada",
        "Salario base",
        "Importe horas extras",
        "Importe nocturnidad",
        "Importe festivos",
        "Importe conceptos",
        "Total bruto",
        "Moneda",
      ];
      const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = [headers.map(escape).join(",")];
      for (const p of prenominas) {
        lines.push(
          [
            escape(p.empleado.dni ?? ""),
            escape(p.empleado.apellidos),
            escape(p.empleado.nombre),
            escape(p.empleado.email),
            p.estado,
            p.diasTrabajados,
            Number(p.horasTrabajadas),
            Number(p.horasOrdinarias),
            Number(p.horasExtras),
            Number(p.horasNocturnas),
            Number(p.horasFestivas),
            p.diasAusenciaPagada,
            p.diasAusenciaNoPagada,
            Number(p.salarioBase),
            Number(p.importeHorasExtras),
            Number(p.importeNocturnidad),
            Number(p.importeFestivos),
            Number(p.importeConceptos),
            Number(p.totalBruto),
            p.moneda,
          ].join(","),
        );
      }
      const csv = "﻿" + lines.join("\r\n") + "\r\n";
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // XLSX vía exceljs (mismo paquete que /api/informes/exportar).
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Prenómina");
    const cols = [
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
    ws.addRow(cols);
    for (const p of prenominas) {
      ws.addRow([
        p.empleado.dni ?? "",
        p.empleado.apellidos,
        p.empleado.nombre,
        p.empleado.email,
        p.estado,
        p.diasTrabajados,
        Number(p.horasTrabajadas),
        Number(p.horasOrdinarias),
        Number(p.horasExtras),
        Number(p.horasNocturnas),
        Number(p.horasFestivas),
        p.diasAusenciaPagada,
        p.diasAusenciaNoPagada,
        Number(p.salarioBase),
        Number(p.importeHorasExtras),
        Number(p.importeNocturnidad),
        Number(p.importeFestivos),
        Number(p.importeConceptos),
        Number(p.totalBruto),
        p.moneda,
      ]);
    }
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }),
);
