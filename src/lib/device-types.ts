/**
 * Tipo compartido cliente/servidor — extraído de `lib/device.ts`
 * para evitar que un import desde un route handler arrastre los
 * hooks de React que viven en ese archivo.
 */
export type DeviceType = "mobile" | "tablet" | "desktop" | "unknown";
