/**
 * Construye un árbol jerárquico de empleados a partir de la lista plana
 * (ordenada por jerarquía con `managerId`). Detecta ciclos y los
 * silencia (un nodo no se puede tener como manager de sí mismo).
 */

export interface Empleado {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  foto: string | null;
  tiendaId: string | null;
  managerId: string | null;
}

export interface NodoOrganigrama extends Empleado {
  hijos: NodoOrganigrama[];
  /** Total de subordinados directos + indirectos. */
  totalSubordinados: number;
}

export function buildOrganigrama(empleados: Empleado[]): NodoOrganigrama[] {
  const byId = new Map<string, NodoOrganigrama>();
  for (const e of empleados) {
    byId.set(e.id, { ...e, hijos: [], totalSubordinados: 0 });
  }
  const roots: NodoOrganigrama[] = [];
  for (const node of byId.values()) {
    if (node.managerId && byId.has(node.managerId) && node.managerId !== node.id) {
      byId.get(node.managerId)!.hijos.push(node);
    } else {
      roots.push(node);
    }
  }
  // Calcular totalSubordinados recursivamente.
  function count(n: NodoOrganigrama): number {
    let total = n.hijos.length;
    for (const h of n.hijos) total += count(h);
    n.totalSubordinados = total;
    return total;
  }
  for (const r of roots) count(r);
  // Ordenar hijos alfabéticamente por nombre.
  function sort(n: NodoOrganigrama): void {
    n.hijos.sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
    );
    n.hijos.forEach(sort);
  }
  roots.forEach(sort);
  roots.sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
  );
  return roots;
}
