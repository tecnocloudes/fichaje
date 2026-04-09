import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const tiendas = [
  { nombre: "Tienda Madrid Centro", ciudad: "Madrid", direccion: "Calle Gran Vía 1", codigoPostal: "28013", latitud: 40.4168, longitud: -3.7038, color: "#6366f1" },
  { nombre: "Tienda Madrid Norte", ciudad: "Madrid", direccion: "Av. de la Paz 45", codigoPostal: "28035", latitud: 40.4763, longitud: -3.6925, color: "#8b5cf6" },
  { nombre: "Tienda Madrid Sur", ciudad: "Madrid", direccion: "Calle de Toledo 22", codigoPostal: "28005", latitud: 40.4050, longitud: -3.7093, color: "#a78bfa" },
  { nombre: "Tienda Barcelona Passeig", ciudad: "Barcelona", direccion: "Passeig de Gràcia 50", codigoPostal: "08007", latitud: 41.3917, longitud: 2.1650, color: "#06b6d4" },
  { nombre: "Tienda Barcelona Diagonal", ciudad: "Barcelona", direccion: "Av. Diagonal 123", codigoPostal: "08018", latitud: 41.3985, longitud: 2.1775, color: "#0ea5e9" },
  { nombre: "Tienda Valencia Centro", ciudad: "Valencia", direccion: "Calle Colón 30", codigoPostal: "46004", latitud: 39.4699, longitud: -0.3763, color: "#f59e0b" },
  { nombre: "Tienda Sevilla", ciudad: "Sevilla", direccion: "Av. de la Constitución 7", codigoPostal: "41001", latitud: 37.3891, longitud: -5.9845, color: "#ef4444" },
  { nombre: "Tienda Bilbao", ciudad: "Bilbao", direccion: "Gran Vía Diego López de Haro 5", codigoPostal: "48001", latitud: 43.2630, longitud: -2.9350, color: "#10b981" },
  { nombre: "Tienda Málaga", ciudad: "Málaga", direccion: "Calle Larios 2", codigoPostal: "29005", latitud: 36.7213, longitud: -4.4213, color: "#f97316" },
  { nombre: "Tienda Zaragoza", ciudad: "Zaragoza", direccion: "Paseo de la Independencia 12", codigoPostal: "50001", latitud: 41.6488, longitud: -0.8891, color: "#84cc16" },
  { nombre: "Tienda Palma", ciudad: "Palma de Mallorca", direccion: "Passeig del Born 20", codigoPostal: "07012", latitud: 39.5696, longitud: 2.6502, color: "#ec4899" },
  { nombre: "Tienda Alicante", ciudad: "Alicante", direccion: "Av. de la Estación 3", codigoPostal: "03007", latitud: 38.3452, longitud: -0.4815, color: "#14b8a6" },
  { nombre: "Tienda Valladolid", ciudad: "Valladolid", direccion: "Calle Santiago 15", codigoPostal: "47001", latitud: 41.6523, longitud: -4.7245, color: "#f43f5e" },
  { nombre: "Tienda Murcia", ciudad: "Murcia", direccion: "Gran Vía Escultor Salzillo 10", codigoPostal: "30004", latitud: 37.9922, longitud: -1.1307, color: "#a3e635" },
  { nombre: "Tienda Vigo", ciudad: "Vigo", direccion: "Calle del Príncipe 22", codigoPostal: "36202", latitud: 42.2328, longitud: -8.7226, color: "#fb923c" },
];

const tiposAusencia = [
  { nombre: "Vacaciones", color: "#6366f1", icono: "sun", pagada: true, requiereAprobacion: true, diasMaximos: 22 },
  { nombre: "Baja por enfermedad", color: "#ef4444", icono: "thermometer", pagada: true, requiereAprobacion: false, diasMaximos: null },
  { nombre: "Asuntos propios", color: "#f59e0b", icono: "user", pagada: false, requiereAprobacion: true, diasMaximos: 3 },
  { nombre: "Permiso de maternidad/paternidad", color: "#ec4899", icono: "baby", pagada: true, requiereAprobacion: false, diasMaximos: null },
  { nombre: "Permiso por defunción", color: "#6b7280", icono: "heart", pagada: true, requiereAprobacion: false, diasMaximos: 5 },
  { nombre: "Día festivo local", color: "#10b981", icono: "star", pagada: true, requiereAprobacion: false, diasMaximos: null },
];

async function main() {
  console.log("🌱 Iniciando seed...");

  // Limpiar base de datos
  await prisma.notificacion.deleteMany();
  await prisma.ausencia.deleteMany();
  await prisma.turno.deleteMany();
  await prisma.fichaje.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tipoAusencia.deleteMany();
  await prisma.tienda.deleteMany();
  await prisma.configuracionEmpresa.deleteMany();

  // Crear configuración empresa
  await prisma.configuracionEmpresa.create({
    data: {
      nombre: "TelecomFichaje",
      horasJornadaDiaria: 8,
      horasSemanales: 40,
      toleranciaFichaje: 15,
      geofencingActivo: true,
      fichajeMovilActivo: true,
      fichajeTabletActivo: true,
    },
  });

  // Crear tipos de ausencia
  const tiposCreados = await Promise.all(
    tiposAusencia.map((t) => prisma.tipoAusencia.create({ data: t }))
  );
  console.log(`✅ ${tiposCreados.length} tipos de ausencia creados`);

  // Crear tiendas
  const tiendasCreadas = await Promise.all(
    tiendas.map((t) => prisma.tienda.create({ data: t }))
  );
  console.log(`✅ ${tiendasCreadas.length} tiendas creadas`);

  const passwordHash = await bcrypt.hash("password123", 12);

  // Crear superadmin
  const superadmin = await prisma.user.create({
    data: {
      email: "admin@telecom.es",
      password: passwordHash,
      nombre: "Carlos",
      apellidos: "García López",
      dni: "12345678A",
      telefono: "600000001",
      rol: "SUPERADMIN",
    },
  });
  console.log("✅ Superadmin creado: admin@telecom.es / password123");

  // Crear managers y empleados para cada tienda
  const empleadosPorTienda = 4;
  let totalEmpleados = 0;

  for (let i = 0; i < tiendasCreadas.length; i++) {
    const tienda = tiendasCreadas[i];
    const tiendaIndex = i + 1;

    // Manager
    await prisma.user.create({
      data: {
        email: `manager.tienda${tiendaIndex}@telecom.es`,
        password: passwordHash,
        nombre: `Manager`,
        apellidos: `Tienda ${tiendaIndex}`,
        dni: `2000000${tiendaIndex}B`,
        telefono: `6001${tiendaIndex.toString().padStart(5, "0")}`,
        rol: "MANAGER",
        tiendaId: tienda.id,
      },
    });

    // Empleados
    for (let j = 1; j <= empleadosPorTienda; j++) {
      const nombres = ["Ana", "Pedro", "María", "Juan", "Laura", "David", "Elena", "Marcos"];
      const apellidos = ["Martínez", "González", "López", "Rodríguez", "Fernández", "Sánchez", "Pérez", "Díaz"];
      await prisma.user.create({
        data: {
          email: `empleado${totalEmpleados + 1}@telecom.es`,
          password: passwordHash,
          nombre: nombres[(totalEmpleados) % nombres.length],
          apellidos: `${apellidos[(totalEmpleados) % apellidos.length]} ${apellidos[(totalEmpleados + 1) % apellidos.length]}`,
          dni: `3${totalEmpleados.toString().padStart(7, "0")}C`,
          telefono: `6100${totalEmpleados.toString().padStart(5, "0")}`,
          rol: "EMPLEADO",
          tiendaId: tienda.id,
        },
      });
      totalEmpleados++;
    }
  }

  console.log(`✅ ${tiendasCreadas.length} managers creados`);
  console.log(`✅ ${totalEmpleados} empleados creados`);

  // Crear fichajes de ejemplo para hoy
  const empleados = await prisma.user.findMany({
    where: { rol: "EMPLEADO" },
    take: 20,
  });

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  for (const emp of empleados.slice(0, 10)) {
    const entrada = new Date(hoy);
    entrada.setHours(9, Math.floor(Math.random() * 15), 0, 0);

    await prisma.fichaje.create({
      data: {
        userId: emp.id,
        tiendaId: emp.tiendaId,
        tipo: "ENTRADA",
        timestamp: entrada,
        metodo: "WEB",
      },
    });

    // Algunos en pausa
    if (Math.random() > 0.5) {
      const pausa = new Date(entrada);
      pausa.setHours(13, 0, 0, 0);
      await prisma.fichaje.create({
        data: {
          userId: emp.id,
          tiendaId: emp.tiendaId,
          tipo: "PAUSA",
          timestamp: pausa,
          metodo: "WEB",
        },
      });

      const vuelta = new Date(pausa);
      vuelta.setMinutes(vuelta.getMinutes() + 30);
      await prisma.fichaje.create({
        data: {
          userId: emp.id,
          tiendaId: emp.tiendaId,
          tipo: "VUELTA_PAUSA",
          timestamp: vuelta,
          metodo: "WEB",
        },
      });
    }
  }

  // 5 empleados ya han salido
  for (const emp of empleados.slice(5, 10)) {
    const salida = new Date(hoy);
    salida.setHours(17, Math.floor(Math.random() * 30), 0, 0);
    await prisma.fichaje.create({
      data: {
        userId: emp.id,
        tiendaId: emp.tiendaId,
        tipo: "SALIDA",
        timestamp: salida,
        metodo: "WEB",
      },
    });
  }

  console.log("✅ Fichajes de ejemplo creados");

  // Crear algunas ausencias pendientes
  const tipoVacaciones = tiposCreados[0];
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const enUnaSemana = new Date();
  enUnaSemana.setDate(enUnaSemana.getDate() + 7);

  for (const emp of empleados.slice(0, 5)) {
    await prisma.ausencia.create({
      data: {
        userId: emp.id,
        tipoAusenciaId: tipoVacaciones.id,
        fechaInicio: manana,
        fechaFin: enUnaSemana,
        dias: 5,
        motivo: "Vacaciones planificadas",
        estado: "PENDIENTE",
      },
    });
  }

  console.log("✅ Ausencias de ejemplo creadas");

  // Crear turnos de esta semana
  const lunes = new Date();
  lunes.setDate(lunes.getDate() - lunes.getDay() + 1);

  for (const emp of empleados.slice(0, 15)) {
    for (let dia = 0; dia < 5; dia++) {
      const fecha = new Date(lunes);
      fecha.setDate(lunes.getDate() + dia);
      await prisma.turno.create({
        data: {
          userId: emp.id,
          tiendaId: emp.tiendaId!,
          fecha,
          horaInicio: "09:00",
          horaFin: "17:00",
          estado: "PUBLICADO",
        },
      });
    }
  }

  console.log("✅ Turnos de la semana creados");
  console.log("\n🎉 Seed completado!");
  console.log("\n📧 Usuarios de acceso:");
  console.log("  Superadmin: admin@telecom.es / password123");
  console.log("  Manager T1: manager.tienda1@telecom.es / password123");
  console.log("  Empleado:   empleado1@telecom.es / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
