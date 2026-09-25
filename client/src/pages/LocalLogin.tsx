import { FormEvent, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { APP_LOGO_DARK_URL, APP_LOGO_URL } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";

const fieldClass =
  "h-12 w-full border-0 bg-transparent px-4 text-[16px] outline-none placeholder:text-[var(--app-fg-3)]";

export function LocalLogin() {
  const utils = trpc.useUtils();
  const { theme, toggleTheme } = useTheme();
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
    <div className="login-shell relative flex min-h-screen items-center justify-center px-5 py-10">
      <button
        type="button"
        className="ios-icon-button absolute right-5 top-5"
        aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
        onClick={toggleTheme}
      >
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>
      <div className="w-full max-w-[420px]">
        <img
          src={theme === "dark" ? APP_LOGO_DARK_URL : APP_LOGO_URL}
          alt="Nazarbayev University — University Service Management"
          className="mx-auto h-[76px] w-auto object-contain"
        />
        <h1 className="ios-title mt-8 text-center text-[34px] leading-tight">
          Вход в систему
        </h1>
        <p className="mt-2 text-center text-[15px]" style={{ color: "var(--app-fg-2)" }}>
          Услуги проживания для физических лиц
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="ios-group">
            <label className="flex items-center">
              <span className="sr-only">Email</span>
              <input
                className={fieldClass}
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="Рабочий Email"
                autoComplete="email"
                required
              />
            </label>
            <div className="ml-4 h-px" style={{ background: "var(--app-sep)" }} />
            <label className="flex items-center">
              <span className="sr-only">Пароль</span>
              <input
                className={fieldClass}
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Пароль"
                autoComplete="current-password"
                required
              />
            </label>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl px-4 py-2.5 text-sm"
              style={{ background: "var(--app-danger-soft)", color: "var(--app-danger)" }}
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={login.isPending}
            className="h-12 w-full rounded-full text-[16px] font-semibold"
          >
            {login.isPending ? "Проверяем…" : "Войти"}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="mt-5 text-center text-[15px]">
          <button
            type="button"
            className="font-medium hover:underline"
            style={{ color: "var(--app-accent-text)" }}
            onClick={() => setShowForgotHint(value => !value)}
          >
            Забыли пароль?
          </button>
          {showForgotHint && (
            <p
              role="status"
              className="mt-3 rounded-xl px-4 py-3 text-sm"
              style={{ background: "var(--app-accent-soft)", color: "var(--app-fg)" }}
            >
              Обратитесь к администратору: он выдаст вам новый временный пароль, а
              после входа вы зададите собственный.
            </p>
          )}
        </div>
        <p className="mt-10 text-center text-xs leading-5" style={{ color: "var(--app-fg-3)" }}>
          Доступ создаёт администратор. Новый сотрудник входит со своим Email и
          временным паролем и сразу задаёт собственный пароль.
        </p>
      </div>
    </div>
  );
}
