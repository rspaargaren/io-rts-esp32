// ── Toast ─────────────────────────────────────────────────────────────────────
(function () {
    var container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);

    function dismissToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.classList.add("toast-hide");
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }

    window.showToast = function (msg, type, duration) {
        var toast = document.createElement("div");
        toast.className = "toast" + (type ? " toast-" + type : "");
        toast.textContent = msg;
        container.appendChild(toast);
        var ms = (duration || 3000);
        var timer = setTimeout(function () { dismissToast(toast); }, ms);
        toast._dismiss = function () { clearTimeout(timer); dismissToast(toast); };
        return toast;
    };
})();

// ── i18n ──────────────────────────────────────────────────────────────────────
let I18N = {};
let FALLBACK = {};
let CURRENT_LANG = "en";
let _allLangs = null;

async function _loadAllLangs() {
    if (_allLangs) return _allLangs;
    const r = await fetch("/languages.json");
    _allLangs = r.ok ? await r.json() : {};
    return _allLangs;
}

function interpolate(text, params = {}) {
    if (typeof text !== "string") return text;
    return text.replace(/\{(\w+)\}/g, (_, key) =>
        Object.prototype.hasOwnProperty.call(params, key) ? params[key] : `{${key}}`);
}

function t(key, params = {}) {
    const value = I18N[key] ?? FALLBACK[key] ?? key;
    return interpolate(value, params);
}

function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.title = t("page.title");
}

async function setLang(lang) {
    const nextLang = lang || "en";
    const langs = await _loadAllLangs();
    I18N = langs[nextLang] || {};
    CURRENT_LANG = nextLang;
    localStorage.setItem("lang", nextLang);
    applyI18n();
    window.dispatchEvent(new CustomEvent("i18n:changed", { detail: { lang: CURRENT_LANG } }));
}

function getLang() { return CURRENT_LANG; }

(async () => {
    const langs = await _loadAllLangs();
    FALLBACK = langs["en"] || {};
    const saved = localStorage.getItem("lang");
    const auto = (navigator.language || "en").slice(0, 2).toLowerCase();
    const initial = saved || auto;
    const supported = ["nl", "en", "de", "fr"];
    const lang = supported.includes(initial) ? initial : "en";
    const select = document.getElementById("lang");
    if (select) select.value = lang;
    await setLang(lang);
})();

window.t = t;
window.setLang = setLang;
window.getLang = getLang;

// ── API ───────────────────────────────────────────────────────────────────────
(function () {
    function ensureJson(response) {
        return response.json().catch(function () { return {}; });
    }

    async function requestJson(url, options) {
        const requestOptions = options || {};
        const method = (requestOptions.method || "GET").toUpperCase();
        const requestUrl = method === "GET"
            ? url + (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now()
            : url;
        if (method === "GET") requestOptions.cache = "no-store";
        const response = await fetch(requestUrl, requestOptions);
        const data = await ensureJson(response);
        if (!response.ok) throw new Error(data.message || ("HTTP error " + response.status));
        return data;
    }

    function otaHeaders(extra) {
        const headers = extra || {};
        const key = window.MiOpenApi && window.MiOpenApi.otaKey;
        if (key) headers["X-OTA-Key"] = key;
        return headers;
    }

    async function postJson(url, payload) {
        return requestJson(url, {
            method: "POST",
            headers: otaHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(payload)
        });
    }

    async function uploadFile(url, file) {
        const formData = new FormData();
        formData.append("file", file);
        return requestJson(url, { method: "POST", headers: otaHeaders(), body: formData });
    }

    async function downloadFile(url, filename) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = window.URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        window.URL.revokeObjectURL(link.href);
    }

    window.MiOpenApi = { downloadFile, postJson, requestJson, uploadFile };
})();
