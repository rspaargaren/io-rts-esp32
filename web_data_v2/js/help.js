(function () {

    var HELP = {
        "wifi": {
            title: "WiFi",
            sections: [
                { label: "What it does", body: "Connects the device to your home WiFi network. WiFi is required for the web interface, MQTT integration, and over-the-air firmware updates." },
                { label: "After saving", body: "The device reboots immediately and attempts to connect. If the credentials are wrong or the network is unreachable, the Fallback AP (io-rts-setup by default) will appear after a short delay." },
                { label: "Scan", body: "Lists nearby networks. Select one to pre-fill the name. You still need to enter the password." }
            ]
        },
        "fallback-ap": {
            title: "Fallback AP",
            sections: [
                { label: "What it does", body: "Creates a local WiFi hotspot when the device cannot reach your network. Connect to it to recover access to the settings page." },
                { label: "Hotspot name", body: "The SSID (WiFi network name) for the fallback hotspot. Default: io-rts-setup. Keep it short and identifiable." },
                { label: "Password", body: "WPA2 password for the hotspot. Minimum 8 characters. Also used as the password for CLI and web interface access. Leave blank for an open (passwordless) network — not recommended if the device is reachable from outside your home." },
                { label: "Retries (boot)", body: "Number of WiFi connection attempts at startup before activating the hotspot. Increase this on networks that are slow to assign addresses." },
                { label: "Retries (running)", body: "Number of reconnection attempts after a disconnect before activating the hotspot." },
                { label: "Timeout (s)", body: "How long the hotspot stays active before shutting down automatically. Set to 0 to keep it on indefinitely. After the timeout, the device returns to normal WiFi-only mode." }
            ]
        },
        "network": {
            title: "Network / IP",
            sections: [
                { label: "DHCP (recommended)", body: "The router assigns an IP address automatically. Access the device at http://io-rts-esp32.local (mDNS) or find its IP in your router's client list." },
                { label: "Static IP", body: "Fixes the device to a specific IP address. Useful when you need a predictable address without relying on mDNS. Always also set Gateway and DNS — without them, cloud imports, time sync, and OTA updates won't work." },
                { label: "Hostname", body: "Used for mDNS (http://<hostname>.local) and as the MQTT client ID if not overridden. Must be 1–32 characters, letters, digits and hyphens only." },
                { label: "SNTP server", body: "Time synchronisation server. Default: pool.ntp.org. Required for accurate timestamps in logs and scheduled operations. Use your router's address if internet access is restricted." }
            ]
        },
        "mqtt": {
            title: "MQTT",
            sections: [
                { label: "What it does", body: "Publishes device position and state to an MQTT broker and listens for control commands. Primary integration method for Home Assistant and Node-RED." },
                { label: "Discovery", body: "When enabled, announces all devices to Home Assistant using the standard MQTT discovery protocol. Devices appear automatically in HA under the configured discovery prefix (default: homeassistant)." },
                { label: "TLS", body: "Use port 8883 for encrypted connections. The broker certificate is validated against the built-in CA bundle. Self-signed certs are not supported." },
                { label: "Topics", body: "Position updates are published to <topic>/<device-id>/state. Commands are received on <topic>/<device-id>/set. The topic root is configurable." }
            ]
        },
        "syslog": {
            title: "Syslog",
            sections: [
                { label: "What it does", body: "Streams log messages in real time to a remote syslog server over UDP (RFC5424 format). Useful for debugging without a serial connection." },
                { label: "Compatible servers", body: "Works with Graylog, Papertrail, rsyslog, and any RFC5424 receiver. Configure the receiver to listen on the same port." },
                { label: "Min level", body: "Controls log verbosity. 7 = debug (everything), 6 = info, 5 = notice, 4 = warning, 3 = error. Higher values mean less output." }
            ]
        },
        "somfy": {
            title: "Somfy / Overkiz",
            sections: [
                { label: "What it does", body: "Imports io-homecontrol devices from your Somfy TaHoma / Connexoon cloud account. Saves time compared to adding devices one by one via the Pair button." },
                { label: "What is imported", body: "Only io-homecontrol devices (roller shutters, awnings, blinds) are imported. Other device types (lights, alarms) are skipped." },
                { label: "Prerequisite", body: "Your devices must already be paired with a TaHoma or Connexoon box and visible in the Somfy app. The import does not pair devices — it copies their identifiers." },
                { label: "Credentials", body: "Uses your Somfy account (email + password). Credentials are sent directly to the Somfy cloud API and are not stored on the device." }
            ]
        },
        "controller": {
            title: "Controller Identity",
            sections: [
                { label: "Node address", body: "The 6-hex-digit io-homecontrol address of this controller (e.g. A1B1C3). Must be unique on your network. Devices are paired to this specific address — changing it makes existing pairings unusable until you re-pair." },
                { label: "TX power", body: "Radio transmit power in dBm, 0–20. Higher values extend range through walls but may cause interference. Default 17 dBm works for most installations. Changes take effect immediately without reboot." },
                { label: "Passive mode", body: "Listens to io-homecontrol traffic without transmitting. Useful for protocol analysis and debugging. In passive mode, no device commands are sent and pairings have no effect." }
            ]
        },
        "io-key": {
            title: "IO System Key",
            sections: [
                { label: "What it is", body: "A 128-bit AES key shared between this controller and all paired io-homecontrol devices. The key is used to authenticate every command — without the correct key no device will respond." },
                { label: "⚠ Changing the key", body: "Changing this key immediately breaks communication with all currently paired devices. You must re-pair every device after a key change.", warn: true },
                { label: "Learn", body: "Receive the key from a TaHoma box or other controller. Put TaHoma in 'share key' mode from its app, then press Learn here. Both controllers will then share the same key and can control the same devices." },
                { label: "Send Key", body: "Push this controller's key to a TaHoma box. Put TaHoma in 'receive key from device' mode from its app, then press Send Key here." },
                { label: "Pair", body: "Add a new io-homecontrol device (roller shutter, awning, blind) to this controller's network. The device receives the current system key during the pairing sequence." },
                { label: "Sniff", body: "Passively captures the system key from live traffic between a remote control and a device. Press a button on the remote during the capture window." }
            ]
        },
        "ota-key": {
            title: "OTA Key",
            sections: [
                { label: "What it is", body: "An authentication token required for firmware and web UI uploads via HTTP. Prevents unauthorized uploads to the device." },
                { label: "Usage", body: "Pass it as the X-OTA-Key header when POSTing to /api/ota (firmware) or /api/upload/web (web files). Retrieve the current key from /api/ota/key at any time." },
                { label: "Rotation", body: "Generate a new random key if the device is accessible from outside your network or if you suspect the key has been exposed." }
            ]
        },
        "backup": {
            title: "Backup / Restore",
            sections: [
                { label: "Backup", body: "Downloads a JSON file containing all device definitions, remote links, WiFi credentials, and settings. Does not include the IO system key or OTA key." },
                { label: "Restore", body: "Uploads a previously saved backup. Existing devices and settings are replaced. The device reboots after a successful restore." }
            ]
        }
    };

    var panel = null;
    var panelTitle = null;
    var panelBody  = null;

    function buildPanel() {
        var el = document.createElement("div");
        el.id = "help-panel";
        el.innerHTML =
            '<div class="help-panel-inner">' +
                '<div class="help-sheet-handle"></div>' +
                '<div class="help-panel-header">' +
                    '<span id="help-panel-title" class="help-panel-title"></span>' +
                    '<button id="help-panel-close" class="help-panel-close" aria-label="Close">✕</button>' +
                '</div>' +
                '<div id="help-panel-body" class="help-panel-body"></div>' +
            '</div>';
        document.body.appendChild(el);

        panelTitle = document.getElementById("help-panel-title");
        panelBody  = document.getElementById("help-panel-body");

        el.addEventListener("click", function (e) { if (e.target === el) closePanel(); });
        document.getElementById("help-panel-close").addEventListener("click", closePanel);
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && el.classList.contains("open")) closePanel();
        });
        return el;
    }

    function openPanel(key) {
        var data = HELP[key];
        if (!data) return;
        if (!panel) panel = buildPanel();

        panelTitle.textContent = data.title;
        panelBody.innerHTML = "";

        data.sections.forEach(function (sec) {
            var block = document.createElement("div");
            block.className = "help-block" + (sec.warn ? " help-block-warn" : "");
            var lbl = document.createElement("div");
            lbl.className = "help-block-label";
            lbl.textContent = sec.label;
            var txt = document.createElement("div");
            txt.className = "help-block-text";
            txt.textContent = sec.body;
            block.appendChild(lbl);
            block.appendChild(txt);
            panelBody.appendChild(block);
        });

        panel.classList.add("open");
    }

    function closePanel() {
        if (panel) panel.classList.remove("open");
    }

    function attachButton(el, key) {
        var label = el.querySelector(".row-label");
        if (!label) return;
        var btn = document.createElement("button");
        btn.className = "help-btn";
        btn.setAttribute("aria-label", "Help for " + (HELP[key] ? HELP[key].title : key));
        btn.textContent = "?";
        btn.addEventListener("click", function (e) { e.stopPropagation(); openPanel(key); });
        label.appendChild(btn);
    }

    function init() {
        document.querySelectorAll("[data-help]").forEach(function (el) {
            attachButton(el, el.getAttribute("data-help"));
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    window.MiOpenHelp = { open: openPanel, close: closePanel };
})();
