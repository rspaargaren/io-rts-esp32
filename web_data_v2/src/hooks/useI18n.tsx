import { useCallback, useEffect, useRef, useState } from "preact/hooks";

// Modern, robust i18n hook for this project.
// - reads preferred language from localStorage key 'io-homecontrol-language'
// - fetches translation JSON from the server (tries several locations)
// - caches fetched languages
// - provides t(key, params) that returns translated value if present, else fallback, else key

type I18nDict = Record<string, string>;

export interface UseI18nResult {
  t: (key: string, params?: Record<string, any>) => string;
  setLang: (lang: string) => Promise<void>;
  getLang: () => string;
  currentLang: string;
  supported: string[];
  apply: () => void;
}

const DEFAULT_SUPPORTED = ["nl", "en", "de", "fr"];
const STORAGE_KEY = "io-homecontrol-language";

export default function useI18n(
  supported: string[] = DEFAULT_SUPPORTED,
): UseI18nResult {
  const [currentLang, setCurrentLang] = useState<string>("en");
  const [i18nState, setI18nState] = useState<I18nDict>({});
  const [fallbackState, setFallbackState] = useState<I18nDict>({});
  const cache = useRef<Record<string, I18nDict>>({});

  const candidatesFor = (lang: string) => [`/lang/${lang}.json`];

  const loadLang = useCallback(async (lang: string): Promise<I18nDict> => {
    if (cache.current[lang]) return cache.current[lang];

    for (const url of candidatesFor(lang)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        if (json && typeof json === "object") {
          cache.current[lang] = json as I18nDict;
          return cache.current[lang];
        }
      } catch (e) {
        // try next
        continue;
      }
    }

    cache.current[lang] = {};
    return {};
  }, []);

  const interpolate = useCallback(
    (text: any, params: Record<string, any> = {}) => {
      if (typeof text !== "string") return text;
      return text.replace(/\{(\w+)\}/g, (_, key) =>
        Object.prototype.hasOwnProperty.call(params, key)
          ? String(params[key])
          : `{${key}}`,
      );
    },
    [],
  );

  const t = useCallback(
    (key: string, params: Record<string, any> = {}) => {
      // Prefer exact presence in current language, then fallback; otherwise return key
      if (Object.prototype.hasOwnProperty.call(i18nState, key)) {
        return interpolate(i18nState[key], params);
      }
      if (Object.prototype.hasOwnProperty.call(fallbackState, key)) {
        return interpolate(fallbackState[key], params);
      }
      return key;
    },
    [i18nState, fallbackState, interpolate],
  );

  const apply = useCallback(() => {
    if (typeof document === "undefined") return;

    document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
      const k = (el.dataset as any).i18n as string | undefined;
      if (!k) return;
      const text = t(k);

      // preserve children except first text node
      let textNode: ChildNode | null = null;
      for (let i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
          textNode = el.childNodes[i];
          break;
        }
      }
      if (textNode) textNode.nodeValue = text;
      else el.insertBefore(document.createTextNode(text), el.firstChild);
    });

    document
      .querySelectorAll<HTMLElement>("[data-i18n-placeholder]")
      .forEach((el) => {
        const k = (el.dataset as any).i18nPlaceholder as string | undefined;
        if (!k) return;
        try {
          (el as any).placeholder = t(k);
        } catch (e) {
          /* ignore */
        }
      });

    try {
      document.title = t("page.title");
    } catch (e) {
      /* ignore */
    }
  }, [t]);

  const setLang = useCallback(
    async (lang: string) => {
      const next = supported.includes(lang) ? lang : "en";
      const dict = await loadLang(next);
      setI18nState(dict || {});
      setCurrentLang(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        /* ignore */
      }
      apply();
      window.dispatchEvent(
        new CustomEvent("i18n:changed", { detail: { lang: next } }),
      );
    },
    [supported, loadLang, apply],
  );

  const getLang = useCallback(() => currentLang, [currentLang]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        saved = null;
      }
      const auto = (
        typeof navigator !== "undefined" ? navigator.language || "en" : "en"
      )
        .slice(0, 2)
        .toLowerCase();
      const initial = saved || auto;
      const lang = supported.includes(initial) ? initial : "en";

      try {
        const select = document.getElementById(
          "lang",
        ) as HTMLSelectElement | null;
        if (select) select.value = lang;
      } catch (e) {
        /* ignore */
      }

      if (!mounted) return;

      if (lang === "en") {
        const en = await loadLang("en");
        setFallbackState(en || {});
        setI18nState(en || {});
        setCurrentLang("en");
        try {
          localStorage.setItem(STORAGE_KEY, "en");
        } catch (e) {
          /* ignore */
        }
        apply();
        window.dispatchEvent(
          new CustomEvent("i18n:changed", { detail: { lang: "en" } }),
        );
      } else {
        const [en, langDict] = await Promise.all([
          loadLang("en"),
          loadLang(lang),
        ]);
        if (!mounted) return;
        setFallbackState(en || {});
        setI18nState(langDict || {});
        setCurrentLang(lang);
        try {
          localStorage.setItem(STORAGE_KEY, lang);
        } catch (e) {
          /* ignore */
        }
        apply();
        window.dispatchEvent(
          new CustomEvent("i18n:changed", { detail: { lang } }),
        );
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loadLang, supported, apply]);

  return {
    t,
    setLang,
    getLang,
    currentLang,
    supported,
    apply,
  } as UseI18nResult;
}
