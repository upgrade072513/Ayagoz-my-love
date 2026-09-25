import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--app-surface)",
          "--normal-text": "var(--app-fg)",
          "--normal-border": "var(--app-sep)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
