import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { canPromptInstall, isIos, isStandalone, promptInstall, subscribeInstall } from "@/lib/pwa";

/** Sidebar button «Установить приложение» (Chrome/Edge prompt; instructions for Safari/iPhone). */
export function InstallAppButton({ collapsed = false }: { collapsed?: boolean }) {
  const [, rerender] = useState(0);
  useEffect(() => subscribeInstall(() => rerender(value => value + 1)), []);
  if (isStandalone()) return null;
  const available = canPromptInstall();
  const ios = isIos();
  const onClick = async () => {
    if (available) {
      const outcome = await promptInstall();
      if (outcome === "accepted") toast.success("Приложение установлено — ищите «USM Проживание» среди программ");
      return;
    }
    if (ios)
      toast.info("На iPhone/iPad: нажмите «Поделиться» в Safari → «На экран „Домой“».", { duration: 8000 });
    else
      toast.info("Откройте меню браузера (⋮ в Chrome или … в Edge) → «Установить приложение» / «Приложения → Установить этот сайт как приложение».", { duration: 9000 });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition hover:bg-black/5"
      style={{ color: "var(--app-accent-text, #8a682d)" }}
      title="Установить как приложение: отдельное окно и значок на рабочем столе"
    >
      <Download className="h-4 w-4 shrink-0" />
      {!collapsed && <span>Установить приложение</span>}
    </button>
  );
}
