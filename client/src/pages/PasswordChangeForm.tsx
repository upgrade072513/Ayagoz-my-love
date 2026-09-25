import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, LogOut } from "lucide-react";

type PasswordChangeFormProps = {
  /** First sign-in with an administrator-issued one-time password. */
  forced?: boolean;
  onLogout?: () => void;
};

export function PasswordChangeForm({
  forced = false,
  onLogout,
}: PasswordChangeFormProps = {}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError("");
      setMessage("Пароль изменён. Все старые сессии завершены.");
      await utils.auth.me.invalidate();
    },
    onError: value => {
      setMessage("");
      setError(value.message);
    },
  });
  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[#9a7633]">
          {forced ? "Первый вход" : "Профиль"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[#3f3f3f]">
          {forced ? "Задайте собственный пароль" : "Смена пароля"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {forced
            ? "Вы вошли с временным паролем, который выдал администратор. Он одноразовый: придумайте свой пароль (минимум 10 символов), чтобы продолжить работу."
            : "Пароль хранится только в виде scrypt-хэша. После изменения все предыдущие сессии будут отозваны."}
        </p>
      </div>
      <form
        className="space-y-5 border border-slate-200 bg-white p-6"
        onSubmit={event => {
          event.preventDefault();
          setError("");
          setMessage("");
          changePassword.mutate({
            currentPassword,
            newPassword,
            confirmPassword,
          });
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          {forced ? "Временный пароль от администратора" : "Текущий пароль"}
          <Input
            className="mt-1.5 h-11"
            type="password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Новый пароль
          <Input
            className="mt-1.5 h-11"
            type="password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Подтвердите новый пароль
          <Input
            className="mt-1.5 h-11"
            type="password"
            value={confirmPassword}
            onChange={event => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
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
        {message && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          >
            {message}
          </p>
        )}
        <Button
          type="submit"
          disabled={changePassword.isPending}
          className="bg-[#18202d] text-white hover:bg-[#273448]"
        >
          <KeyRound className="mr-2 h-4 w-4" />
          {changePassword.isPending
            ? "Сохраняем…"
            : forced
              ? "Сохранить и продолжить"
              : "Изменить пароль"}
        </Button>
        {forced && onLogout && (
          <Button
            type="button"
            variant="ghost"
            className="ml-2"
            onClick={onLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Выйти
          </Button>
        )}
      </form>
    </section>
  );
}
