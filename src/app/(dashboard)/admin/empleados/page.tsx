"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Edit2, UserX, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn, getColorRol, getLabelRol } from "@/lib/utils";

interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  dni?: string;
  telefono?: string;
  rol: "SUPERADMIN" | "MANAGER" | "EMPLEADO";
  activo: boolean;
  tiendaId?: string;
  tienda?: { nombre: string; color: string };
}

interface Tienda {
  id: string;
  nombre: string;
  color: string;
}

const FORM_INICIAL = {
  nombre: "", apellidos: "", email: "", dni: "", telefono: "",
  password: "", rol: "EMPLEADO" as "SUPERADMIN" | "MANAGER" | "EMPLEADO", tiendaId: "",
};

export default function EmpleadosPage() {
  const { toast } = useToast();
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTienda, setFiltroTienda] = useState("todas");
  const [filtroRol, setFiltroRol] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<Empleado | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(FORM_INICIAL);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, tiendasRes] = await Promise.all([
        fetch("/api/empleados"),
        fetch("/api/tiendas"),
      ]);
      const [empData, tiendasData] = await Promise.all([empRes.json(), tiendasRes.json()]);
      setEmpleados(empData.empleados || []);
      setTiendas(tiendasData.tiendas || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const empleadosFiltrados = empleados.filter((e) => {
    const matchSearch = busqueda
      ? `${e.nombre} ${e.apellidos} ${e.email} ${e.dni || ""}`.toLowerCase().includes(busqueda.toLowerCase())
      : true;
    const matchTienda = filtroTienda === "todas" ? true : e.tiendaId === filtroTienda;
    const matchRol = filtroRol === "todos" ? true : e.rol === filtroRol;
    return matchSearch && matchTienda && matchRol;
  });

  const abrirCrear = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setDialogOpen(true);
  };

  const abrirEditar = (emp: Empleado) => {
    setEditando(emp);
    setForm({
      nombre: emp.nombre, apellidos: emp.apellidos, email: emp.email,
      dni: emp.dni || "", telefono: emp.telefono || "", password: "",
      rol: emp.rol, tiendaId: emp.tiendaId || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nombre || !form.apellidos || !form.email) {
      toast({ title: "Nombre, apellidos y email son obligatorios", variant: "destructive" });
      return;
    }
    if (!editando && !form.password) {
      toast({ title: "La contraseña es obligatoria", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body: any = { ...form };
      if (editando && !body.password) delete body.password;
      if (!body.tiendaId) body.tiendaId = null;

      const url = editando ? `/api/empleados/${editando.id}` : "/api/empleados";
      const method = editando ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error");
      }
      toast({ title: editando ? "Empleado actualizado" : "Empleado creado" });
      setDialogOpen(false);
      fetchData();
    } catch (e: any) {
      toast({ title: e.message || "Error al guardar", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActivo = async (emp: Empleado) => {
    try {
      const res = await fetch(`/api/empleados/${emp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !emp.activo }),
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Empleados</h1>
          <p className="text-gray-500 text-sm mt-1">{empleados.length} empleados registrados</p>
        </div>
        <Button onClick={abrirCrear}>
          <Plus className="h-4 w-4 mr-2" /> Nuevo Empleado
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por nombre, email, DNI..."
            className="pl-9"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={filtroTienda} onValueChange={setFiltroTienda}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todas las tiendas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las tiendas</SelectItem>
            {tiendas.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroRol} onValueChange={setFiltroRol}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Todos los roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los roles</SelectItem>
            <SelectItem value="EMPLEADO">Empleado</SelectItem>
            <SelectItem value="MANAGER">Manager</SelectItem>
            <SelectItem value="SUPERADMIN">Super Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : empleadosFiltrados.length === 0 ? (
            <div className="py-12 text-center text-gray-400">No se encontraron empleados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["Empleado", "Email", "DNI", "Rol", "Tienda", "Estado", ""].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {empleadosFiltrados.map((emp) => (
                    <tr key={emp.id} className={cn("hover:bg-gray-50 transition-colors", !emp.activo && "opacity-50")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-xs">
                            {emp.nombre[0]}{emp.apellidos[0]}
                          </div>
                          <span className="font-medium text-gray-900 text-sm">
                            {emp.nombre} {emp.apellidos}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{emp.email}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{emp.dni || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", getColorRol(emp.rol))}>
                          {getLabelRol(emp.rol)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {emp.tienda ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.tienda.color }} />
                            <span className="text-gray-600 truncate max-w-[120px]">{emp.tienda.nombre}</span>
                          </span>
                        ) : <span className="text-gray-400">Sin tienda</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", emp.activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                          {emp.activo ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(emp)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleToggleActivo(emp)}
                            title={emp.activo ? "Desactivar" : "Activar"}
                          >
                            {emp.activo
                              ? <UserX className="h-3.5 w-3.5 text-red-400" />
                              : <UserCheck className="h-3.5 w-3.5 text-green-500" />
                            }
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Empleado" : "Nuevo Empleado"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nombre *</Label>
                <Input className="mt-1" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div>
                <Label>Apellidos *</Label>
                <Input className="mt-1" value={form.apellidos} onChange={(e) => setForm((f) => ({ ...f, apellidos: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Email *</Label>
                <Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>DNI</Label>
                <Input className="mt-1" value={form.dni} onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))} />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input className="mt-1" value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} />
              </div>
              <div>
                <Label>{editando ? "Nueva contraseña (vacío = no cambiar)" : "Contraseña *"}</Label>
                <Input className="mt-1" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={editando ? "••••••••" : ""} />
              </div>
              <div>
                <Label>Rol</Label>
                <Select value={form.rol} onValueChange={(v) => setForm((f) => ({ ...f, rol: v as any }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLEADO">Empleado</SelectItem>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="SUPERADMIN">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Tienda asignada</Label>
                <Select value={form.tiendaId || "ninguna"} onValueChange={(v) => setForm((f) => ({ ...f, tiendaId: v === "ninguna" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Sin tienda" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna">Sin tienda</SelectItem>
                    {tiendas.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Guardando..." : editando ? "Actualizar" : "Crear Empleado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
