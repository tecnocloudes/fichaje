"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, ArrowRight, ArrowLeft, Store, User, Rocket, Eye, EyeOff, RefreshCw, Copy, Check } from "lucide-react";

type Step = "admin" | "tienda" | "confirmar";

const STEPS: { key: Step; label: string }[] = [
  { key: "admin", label: "Cuenta admin" },
  { key: "tienda", label: "Primera sede" },
  { key: "confirmar", label: "Confirmar" },
];

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}";
function generatePassword() {
  return Array.from({ length: 32 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("admin");

  useEffect(() => {
    fetch("/api/setup").then(r => r.json()).then(d => {
      if (!d.needsSetup) router.replace("/login");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const [admin, setAdmin] = useState({ nombre: "", apellidos: "", email: "", password: "", password2: "" });
  const [tienda, setTienda] = useState({ nombre: "", direccion: "", ciudad: "" });
  const [saltarTienda, setSaltarTienda] = useState(false);
  const [passwordGenerado, setPasswordGenerado] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const handleCopiar = () => {
    if (!admin.password) return;
    navigator.clipboard.writeText(admin.password).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  };

  const stepIndex = STEPS.findIndex(s => s.key === step);

  const handleGenerarPassword = () => {
    const pwd = generatePassword();
    setAdmin(a => ({ ...a, password: pwd, password2: pwd }));
    setPasswordGenerado(true);
    setShowPassword(true);
  };

  const validateAdmin = () => {
    if (!admin.nombre || !admin.apellidos || !admin.email || !admin.password)
      return "Todos los campos son obligatorios";
    if (admin.password.length < 8)
      return "La contraseña debe tener al menos 8 caracteres";
    if (!passwordGenerado && admin.password !== admin.password2)
      return "Las contraseñas no coinciden";
    if (!admin.email.includes("@"))
      return "El email no es válido";
    return null;
  };

  const validateTienda = () => {
    if (saltarTienda) return null;
    if (!tienda.nombre || !tienda.direccion || !tienda.ciudad)
      return "Rellena todos los campos de la sede o sáltate este paso";
    return null;
  };

  const handleNext = () => {
    setError("");
    if (step === "admin") {
      const err = validateAdmin();
      if (err) { setError(err); return; }
      setStep("tienda");
    } else if (step === "tienda") {
      const err = validateTienda();
      if (err) { setError(err); return; }
      setStep("confirmar");
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        nombre: admin.nombre,
        apellidos: admin.apellidos,
        email: admin.email,
        password: admin.password,
      };
      if (!saltarTienda && tienda.nombre) {
        body.tienda = { nombre: tienda.nombre, direccion: tienda.direccion, ciudad: tienda.ciudad };
      }
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al configurar el sistema");
        return;
      }
      setDone(true);
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center p-4">
        <div className="text-center space-y-6 max-w-sm">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">¡Sistema configurado!</h1>
            <p className="text-gray-500 mt-2">Tu cuenta de administrador ha sido creada. Ya puedes iniciar sesión.</p>
          </div>
          <Button className="w-full" onClick={() => router.push("/login")}>
            Ir al login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Rocket className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Configuración inicial</h1>
          <p className="text-gray-500 text-sm mt-1">Prepara tu sistema de fichajes</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                i < stepIndex ? "bg-indigo-600 text-white" :
                i === stepIndex ? "bg-indigo-600 text-white ring-4 ring-indigo-100" :
                "bg-gray-200 text-gray-400"
              }`}>
                {i < stepIndex ? <CheckCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-xs font-medium ${i === stepIndex ? "text-indigo-600" : "text-gray-400"}`}>{s.label}</span>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-200 ml-1" />}
            </div>
          ))}
        </div>

        <Card className="shadow-sm">
          <CardContent className="pt-6 space-y-4">

            {/* Step 1: Admin */}
            {step === "admin" && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <User className="h-5 w-5 text-indigo-600" />
                  <h2 className="font-semibold text-gray-800">Cuenta de administrador</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Nombre</Label>
                    <Input className="mt-1" value={admin.nombre} onChange={e => setAdmin(a => ({ ...a, nombre: e.target.value }))} placeholder="Ana" />
                  </div>
                  <div>
                    <Label>Apellidos</Label>
                    <Input className="mt-1" value={admin.apellidos} onChange={e => setAdmin(a => ({ ...a, apellidos: e.target.value }))} placeholder="García" />
                  </div>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input className="mt-1" type="email" value={admin.email} onChange={e => setAdmin(a => ({ ...a, email: e.target.value }))} placeholder="admin@empresa.com" />
                </div>
                <div>
                  <Label>Contraseña</Label>
                  <div className="mt-1 flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={admin.password}
                        onChange={e => {
                          setAdmin(a => ({ ...a, password: e.target.value }));
                          setPasswordGenerado(false);
                        }}
                        placeholder="Mínimo 8 caracteres"
                        className="pr-10 font-mono"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword(v => !v)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="shrink-0 px-3" onClick={handleGenerarPassword} title="Generar contraseña aleatoria">
                      <RefreshCw className="h-4 w-4 mr-1" /> Generar
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="shrink-0 px-3" onClick={handleCopiar} disabled={!admin.password} title="Copiar contraseña">
                      {copiado ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  {passwordGenerado && (
                    <p className="text-xs text-indigo-600 mt-1">Contraseña generada automáticamente. Guárdala en un lugar seguro.</p>
                  )}
                </div>
                {!passwordGenerado && (
                  <div>
                    <Label>Repetir contraseña</Label>
                    <Input className="mt-1" type="password" value={admin.password2} onChange={e => setAdmin(a => ({ ...a, password2: e.target.value }))} placeholder="Repite la contraseña" />
                  </div>
                )}
              </>
            )}

            {/* Step 2: Tienda */}
            {step === "tienda" && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Store className="h-5 w-5 text-indigo-600" />
                  <h2 className="font-semibold text-gray-800">Primera sede (opcional)</h2>
                </div>
                <p className="text-sm text-gray-500">Puedes crear sedes más adelante desde el panel de administración.</p>
                {!saltarTienda && (
                  <>
                    <div>
                      <Label>Nombre de la sede</Label>
                      <Input className="mt-1" value={tienda.nombre} onChange={e => setTienda(t => ({ ...t, nombre: e.target.value }))} placeholder="Sede Centro" />
                    </div>
                    <div>
                      <Label>Dirección</Label>
                      <Input className="mt-1" value={tienda.direccion} onChange={e => setTienda(t => ({ ...t, direccion: e.target.value }))} placeholder="Calle Mayor 1" />
                    </div>
                    <div>
                      <Label>Ciudad</Label>
                      <Input className="mt-1" value={tienda.ciudad} onChange={e => setTienda(t => ({ ...t, ciudad: e.target.value }))} placeholder="Madrid" />
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className="text-sm text-indigo-600 hover:underline"
                  onClick={() => setSaltarTienda(s => !s)}
                >
                  {saltarTienda ? "Quiero crear una sede ahora" : "Saltar este paso"}
                </button>
              </>
            )}

            {/* Step 3: Confirmar */}
            {step === "confirmar" && (
              <>
                <h2 className="font-semibold text-gray-800 mb-2">Resumen de configuración</h2>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <div>
                    <span className="text-gray-500">Administrador:</span>{" "}
                    <span className="font-medium text-gray-900">{admin.nombre} {admin.apellidos}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Email:</span>{" "}
                    <span className="font-medium text-gray-900">{admin.email}</span>
                  </div>
                  {!saltarTienda && tienda.nombre && (
                    <div>
                      <span className="text-gray-500">Primera sede:</span>{" "}
                      <span className="font-medium text-gray-900">{tienda.nombre} — {tienda.ciudad}</span>
                    </div>
                  )}
                  {(saltarTienda || !tienda.nombre) && (
                    <div className="text-gray-400 italic">Sin sede inicial (puedes añadirla después)</div>
                  )}
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-3">
          {stepIndex > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => {
              setError("");
              setStep(STEPS[stepIndex - 1].key);
            }}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Atrás
            </Button>
          )}
          {step !== "confirmar" ? (
            <Button className="flex-1" onClick={handleNext}>
              Siguiente <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button className="flex-1" onClick={handleSubmit} disabled={loading}>
              {loading ? "Configurando..." : "Finalizar configuración"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
