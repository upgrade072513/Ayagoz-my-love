import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Building2,
  ChevronRight,
  KeyRound,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { APP_LOGO_URL } from "@/const";

export function LocalLogin() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showForgotHint, setShowForgotHint] = useState(false);
  const login = trpc.auth.login.useMutation({
    onSuccess: user => {
      utils.auth.me.setData(undefined, user);
    },
    onError: error => setError(error.message || "Неверный Email или пароль"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    login.mutate({ email, password });
  };

  return (
    <div className="login-shell flex min-h-screen items-center justify-center p-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-900/10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden bg-[#18202d] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex h-16 w-24 items-center justify-center rounded-xl bg-white">
              <img
                src={APP_LOGO_URL}
                alt="Nazarbayev University"
                className="h-full w-full object-contain p-1"
              />
            </div>
            <p className="mt-10 text-xs uppercase tracking-[0.24em] text-[#d8b46b]">
              University Service Management
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight">
              Услуги проживания
              <br />
              для физических лиц
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-slate-300">
              Единое защищённое пространство для договоров, начислений, сканов и
              контроля оплат.
            </p>
          </div>
          <div className="space-y-3 text-sm text-slate-300">
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#d8b46b]" /> Server-side
              session и HttpOnly cookie
            </p>
            <p className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#d8b46b]" /> Доступ управляется
              администратором
            </p>
          </div>
        </div>
        <div className="p-8 sm:p-12">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#18202d] text-[#d8b46b] shadow-lg lg:hidden">
            <Building2 className="h-6 w-6" />
          </div>
          <p className="eyebrow mt-7 lg:mt-0">Nazarbayev University</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#18202d]">
            Вход в систему
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Используйте рабочий Email и пароль
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Email
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-11 pl-10"
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="name@nu.edu.kz"
                  autoComplete="email"
                  required
                />
              </div>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Пароль
              <Input
                className="mt-1.5 h-11"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={login.isPending}
              className="h-11 w-full rounded-xl bg-[#18202d] text-white hover:bg-[#273448]"
            >
              {login.isPending ? "Проверяем…" : "Войти"}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </form>
          <div className="mt-6 text-sm">
            <button
              type="button"
              className="text-[#8a682d] hover:underline"
              onClick={() => setShowForgotHint(value => !value)}
            >
              Забыли пароль?
            </button>
            {showForgotHint && (
              <p
                role="status"
                className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"
              >
                Обратитесь к администратору: он выдаст вам новый временный
                пароль, а после входа вы зададите собственный.
              </p>
            )}
          </div>
          <p className="mt-10 text-xs leading-5 text-slate-400">
            Доступ создаёт администратор. Новый сотрудник входит со своим Email
            и временным паролем, полученным от администратора, и сразу задаёт
            собственный пароль. Самостоятельная регистрация отключена.
          </p>
        </div>
      </div>
    </div>
  );
}
