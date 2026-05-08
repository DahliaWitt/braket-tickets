(function () {
  const html = document.documentElement;

  try {
    const theme = localStorage.theme;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

    const isSystem = theme === 'system' || !('theme' in localStorage);
    const isDark = theme === 'dark' || (isSystem && prefersDark);
    const resolvedTheme = isDark ? 'dark' : 'light';
    html.classList.toggle('dark', isDark);
    html.classList.toggle('dark-theme', isDark);
    html.setAttribute('data-theme', theme ?? 'system');
    html.style.colorScheme = resolvedTheme;
  } catch {
    // localStorage may be blocked (private browsing) — fail silently
  }
})();
