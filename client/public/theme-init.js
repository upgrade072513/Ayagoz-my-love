// Applies the saved theme before the page paints (no white flash in dark mode).
// A separate file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  var t =
    localStorage.getItem("ussh-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (t === "dark") document.documentElement.classList.add("dark");
} catch (e) {}
