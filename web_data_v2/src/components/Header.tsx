import { useEffect, useState } from "preact/hooks";
import useI18n from "../hooks/useI18n";
import { useInfo } from "../hooks/api/useInfo.tsx";

const LANGUAGE_STORAGE_KEY = "io-homecontrol-language";
const THEME_STORAGE_KEY = "io-homecontrol-theme";

function getStoredValue(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function Header() {
  const t = useI18n();

  const info = useInfo(60); // Refresh every 60 seconds

  const [language, setLanguage] = useState<string>(() =>
    getStoredValue(LANGUAGE_STORAGE_KEY, "en"),
  );
  const [theme, setTheme] = useState<string>(() =>
    getStoredValue(THEME_STORAGE_KEY, "charcoal"),
  );

  useEffect(() => {
    try {
      t.setLang(language);
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore storage failures (e.g. private mode or disabled storage).
    }
  }, [language]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures (e.g. private mode or disabled storage).
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <header class="app-header">
      <div class="header-left">
        <div class={info.loaded ? "app-dot" : "app-dot offline"}></div>
        <img src="img/logo.png" alt="" style="height:24px;width:auto;" />
        <span class="app-wordmark">io-homecontrol</span>
      </div>
      <div class="header-right">
        <div id="pairing-badge" style="display:none"></div>
        <span class="pill amber hidden"></span>
        <select
          class="hdr-btn"
          id="lang"
          style="border:none;cursor:pointer;"
          onChange={(e) => setLanguage(e.currentTarget.value)}
          value={language}
        >
          <option value="nl">NL</option>
          <option value="en">EN</option>
          <option value="de">DE</option>
          <option value="fr">FR</option>
        </select>
        <select
          class="hdr-btn"
          aria-label="Theme"
          style="border:none;cursor:pointer;"
          onChange={(e) => setTheme(e.currentTarget.value)}
          value={theme}
        >
          <option value="charcoal">● Charcoal</option>
          <option value="navy">◑ Navy</option>
          <option value="light">○ Light</option>
          <option value="purple">◆ Purple</option>
        </select>
      </div>
    </header>
  );
}
