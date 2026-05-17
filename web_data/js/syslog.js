(function () {
    async function loadSyslogConfig(app) {
        try {
            const cfg = await window.MiOpenApi.requestJson("/api/syslog");
            app.elements.syslogEnabledInput.checked   = !!cfg.enabled;
            app.elements.syslogServerInput.value       = cfg.server    || "";
            app.elements.syslogPortInput.value         = cfg.port      || "514";
            app.elements.syslogFacilityInput.value     = cfg.facility  != null ? cfg.facility : "1";
            app.elements.syslogMinLevelInput.value     = cfg.min_level != null ? String(cfg.min_level) : "7";
        } catch (error) {
            console.error("Error fetching syslog config", error);
        }
    }

    async function updateSyslogConfig(app) {
        try {
            const result = await window.MiOpenApi.postJson("/api/syslog", {
                enabled:   app.elements.syslogEnabledInput.checked,
                server:    app.elements.syslogServerInput.value,
                port:      parseInt(app.elements.syslogPortInput.value, 10) || 514,
                facility:  parseInt(app.elements.syslogFacilityInput.value, 10),
                min_level: parseInt(app.elements.syslogMinLevelInput.value, 10)
            });
            app.logStatus(result.message || "Syslog settings saved.", "info");
        } catch (error) {
            app.logStatus("Error updating syslog config: " + error.message, "error");
        }
    }

    function init(app) {
        app.loadSyslogConfig  = function () { return loadSyslogConfig(app); };
        app.updateSyslogConfig = function () { return updateSyslogConfig(app); };
    }

    window.MiOpenSyslog = { init: init };
})();
