(function () {
var FAV_PREFIX = "fav_pos_";
function getFavPos(id) {
var v = localStorage.getItem(FAV_PREFIX + id);
return v !== null ? parseInt(v, 10) : null;
}
function setFavPos(id, pos) {
localStorage.setItem(FAV_PREFIX + id, pos);
}
function getDeviceGroup(device) {
var SHUTTER  = ["ROLLER_SHUTTER","BLIND","DUAL_SHUTTER","AWNING",
"HORIZONTAL_AWNING","EXTERNAL_VENETIAN_BLIND",
"CURTAIN_TRACK","SWINGING_SHUTTER"];
var VENETIAN = ["VENETIAN_BLIND","LOUVRE_BLIND"];
var WINDOW   = ["WINDOW_OPENER"];
var GATE     = ["GARAGE_OPENER","GATE_OPENER","ROLLING_DOOR_OPENER"];
var t = (device.type_name || "UNKNOWN").toUpperCase().replace(/[\s\-]+/g, "_");
if (SHUTTER.indexOf(t)  !== -1) return "shutter";
if (VENETIAN.indexOf(t) !== -1) return "venetian";
if (WINDOW.indexOf(t)   !== -1) return "window";
if (GATE.indexOf(t)     !== -1) return "gate";
if (t === "ON_OFF_SWITCH") return "switch";
if (t === "LIGHT") return device.subtype === 58 ? "switch" : "dimmer";
return "readonly";
}
async function runAction(app, deviceId, action, value) {
const payload = { deviceId: deviceId, action: action };
if (value !== undefined) payload.value = value;
const result = await window.MiOpenApi.postJson("/api/action", payload);
if (result.success === false) {
markUnreachable(deviceId);
throw new Error(result.message || "Action failed");
}
app.logStatus(result.message || ("Action " + action + " sent."), "debug");
return result;
}
function markUnreachable(deviceId) {
var el = document.querySelector('.device[data-id="' + deviceId + '"]');
if (el) el.classList.add("unreachable");
}
function openPct(pos) {
return pos < 0 ? null : 100 - pos;
}
function posStateLabel(pos) {
if (pos < 0)    return window.t ? window.t("label.pos_unknown") : "Unknown";
if (pos === 0)  return window.t ? window.t("label.pos_open")    : "Open";
if (pos === 100)return window.t ? window.t("label.pos_closed")  : "Closed";
return window.t ? window.t("label.pos_partial") : "Partial";
}
function buildPosIndicator(device) {
var op = openPct(device.position);
var fillW = op !== null ? op : 0;
var wrapper = document.createElement("div");
wrapper.className = "pos-indicator";
var topRow = document.createElement("div");
topRow.className = "pos-top-row";
var valEl = document.createElement("span");
valEl.className = "pos-value" + (op === null ? " unknown" : "");
valEl.textContent = op !== null ? device.position + "%" : "—";
var stateEl = document.createElement("span");
stateEl.className = "pos-state";
stateEl.textContent = posStateLabel(device.position);
topRow.appendChild(valEl);
topRow.appendChild(stateEl);
var strip = document.createElement("div");
strip.className = "light-strip";
var fill = document.createElement("div");
fill.className = "light-fill";
fill.style.width = fillW + "%";
strip.appendChild(fill);
wrapper.appendChild(topRow);
wrapper.appendChild(strip);
return wrapper;
}
function updateDeviceFill(deviceId, percent, inverted, estimated) {
var el = document.querySelector('.device[data-id="' + deviceId + '"]');
if (!el) return;
el.classList.remove("unreachable");
el.classList.toggle("estimating", !!estimated);
var fill   = el.querySelector(".light-fill");
var valEl  = el.querySelector(".pos-value");
var stateEl= el.querySelector(".pos-state");
var slider = el.querySelector(".card-slider[data-slider='position']");
var op     = percent < 0 ? null : (inverted ? percent : 100 - percent);
if (fill)   fill.style.width    = (op !== null ? op : 0) + "%";
if (valEl)  valEl.textContent   = percent >= 0 ? percent + "%" : "—";
if (stateEl)stateEl.textContent = posStateLabel(percent);
if (slider) slider.value        = percent;
}
function updateDeviceState(deviceId, isStopped) {
var el = document.querySelector('.device[data-id="' + deviceId + '"]');
if (el) el.classList.toggle("moving", isStopped === false);
}
function makeBtn(text, onClick) {
var btn = document.createElement("button");
btn.textContent = text;
btn.className = "card-btn";
btn.addEventListener("click", onClick);
return btn;
}
function makeTextBtn(text, onClick) {
var btn = document.createElement("button");
btn.textContent = text;
btn.className = "btn-text";
btn.addEventListener("click", onClick);
return btn;
}
function makeRow(buttons) {
var row = document.createElement("div");
row.className = "card-btn-row";
buttons.forEach(function (b) { row.appendChild(b); });
return row;
}
function makeSlider(app, device, action, initVal) {
var wrapper = document.createElement("div");
wrapper.className = "card-slider-row";
var lbl = document.createElement("span");
lbl.className = "card-slider-label";
lbl.textContent = action === "tilt" ? app.i18nText("label.tilt", "Tilt")
: action === "dim"              ? app.i18nText("label.dim",  "Dim")
: app.i18nText("label.position", "Pos");
var sl = document.createElement("input");
sl.type = "range"; sl.min = "0"; sl.max = "100";
sl.value = (initVal !== undefined && initVal >= 0) ? initVal : 0;
sl.className = "card-slider";
if (action === "position") {
sl.dataset.slider = "position";
}
sl.addEventListener("change", function () {
runAction(app, device.id, action, parseInt(sl.value, 10))
.catch(function (e) { showToast(e.message, "error"); });
});
wrapper.appendChild(lbl);
wrapper.appendChild(sl);
return wrapper;
}
function makeFavBtn(app, device) {
var fav = getFavPos(device.id);
var btn = document.createElement("button");
btn.className = "card-btn card-fav" + (fav !== null ? " has-favorite" : "");
btn.textContent = "★";
btn.setAttribute("aria-label", app.i18nText("button.favorite", "Favourite"));
btn.title = fav !== null
? (app.i18nText("button.favorite", "Favorite") + ": " + fav + "%")
: app.i18nText("popup.no_favorite_set", "No favorite set");
btn.dataset.favDevice = device.id;
btn.addEventListener("click", function () {
var pos = getFavPos(device.id);
if (pos === null) {
app.logStatus(app.i18nText("popup.no_favorite_set", "No favorite set — use Edit to set one."), "info");
return;
}
runAction(app, device.id, "position", pos)
.catch(function (e) { app.logStatus(e.message, "error"); });
});
return btn;
}
function updateFavButton(deviceId) {
var btn = document.querySelector('button[data-fav-device="' + deviceId + '"]');
if (!btn) return;
var fav = getFavPos(deviceId);
btn.className = "card-btn card-fav" + (fav !== null ? " has-favorite" : "");
btn.title = fav !== null ? ("Favorite: " + fav + "%") : "No favorite set";
}
function buildControls(app, device, li, group) {
if (group === "shutter" || group === "venetian" || group === "window") {
li.appendChild(makeRow([
makeBtn("↑", function () { runAction(app, device.id, "open").catch(function (e) { showToast(e.message, "error"); }); }),
makeBtn("■", function () { runAction(app, device.id, "stop").catch(function (e) { showToast(e.message, "error"); }); }),
makeBtn("↓", function () { runAction(app, device.id, "close").catch(function (e) { showToast(e.message, "error"); }); }),
makeFavBtn(app, device)
]));
li.appendChild(makeSlider(app, device, "position", device.position));
if (group === "venetian") {
li.appendChild(makeSlider(app, device, "tilt", device.tilt));
}
} else if (group === "gate") {
li.appendChild(makeRow([
makeBtn("↑", function () { runAction(app, device.id, "open").catch(function (e) { showToast(e.message, "error"); }); }),
makeBtn("↓", function () { runAction(app, device.id, "close").catch(function (e) { showToast(e.message, "error"); }); })
]));
} else if (group === "switch" || group === "dimmer") {
li.appendChild(makeRow([
makeTextBtn(app.i18nText("button.on", "On"),  function () { runAction(app, device.id, "on").catch(function (e) { showToast(e.message, "error"); }); }),
makeTextBtn(app.i18nText("button.off", "Off"),function () { runAction(app, device.id, "off").catch(function (e) { showToast(e.message, "error"); }); })
]));
if (group === "dimmer") {
li.appendChild(makeSlider(app, device, "dim", 0));
}
} else {
var span = document.createElement("span");
span.className = "device-status-only";
span.textContent = app.i18nText("label.status_only", "Status only");
li.appendChild(span);
}
}
function closeDeviceEditModal() {
var m = document.getElementById("device-edit-modal");
if (m) m.classList.remove("open");
window.MiOpenDevices.onCalibrationProgress = null;
window.MiOpenDevices.onCalibrationDone = null;
window.MiOpenDevices.onCalibrationFailed = null;
}
function devRow(labelText, subText, rightEl) {
var row = document.createElement("div");
row.className = "dev-row";
var L = document.createElement("div");
var lbl = document.createElement("div");
lbl.className = "dev-row-label";
lbl.textContent = labelText;
L.appendChild(lbl);
if (subText) {
var sub = document.createElement("div");
sub.className = "dev-row-sub";
sub.textContent = subText;
L.appendChild(sub);
}
row.appendChild(L);
if (rightEl) {
var R = document.createElement("div");
R.className = "dev-row-right";
(Array.isArray(rightEl) ? rightEl : [rightEl]).forEach(function (el) { R.appendChild(el); });
row.appendChild(R);
}
return row;
}
function devBtn(text, cls) {
var btn = document.createElement("button");
btn.textContent = text;
btn.className = "s-btn " + (cls || "");
return btn;
}
function openDeviceEditModal(app, device, group) {
var modal = document.getElementById("device-edit-modal");
if (!modal) return;
var nameEl = document.getElementById("dev-sheet-name");
var metaEl = document.getElementById("dev-sheet-meta");
var body   = document.getElementById("dev-sheet-body");
if (!nameEl || !metaEl || !body) return;
var hasPos = (group === "shutter" || group === "venetian" || group === "window" || group === "gate");
var hasFav = (group === "shutter" || group === "venetian" || group === "window");
nameEl.textContent = device.name;
metaEl.textContent = (device.type_name || app.i18nText("popup.type_unknown", "Unknown"))
+ (device.manufacturer ? " · " + device.manufacturer : "")
+ " · " + device.id
+ (device.inactive ? " · " + app.i18nText("popup.device_inactive_text", "inactive") : "");
body.innerHTML = "";
var nameInput = document.createElement("input");
nameInput.type = "text";
nameInput.className = "s-input";
nameInput.value = device.name;
nameInput.style.flex = "1";
var nameSave = devBtn(app.i18nText("button.save", "Save"), "primary");
nameSave.style.flexShrink = "0";
nameSave.onclick = function () {
var val = nameInput.value.trim();
if (!val) { showToast(app.i18nText("popup.rename_empty", "Name cannot be empty."), "error"); return; }
if (val === device.name) { closeDeviceEditModal(); return; }
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "rename", value: val })
.then(function (r) {
if (!r.success) { showToast(r.message || app.i18nText("popup.rename_failed", "Rename failed."), "error"); return; }
showToast(r.message || app.i18nText("popup.renamed", "Renamed."), "success");
device.name = val;
nameEl.textContent = val;
fetchAndDisplayDevices(app);
closeDeviceEditModal();
})
.catch(function (e) { showToast(e.message, "error"); });
};
var nameRow = document.createElement("div");
nameRow.className = "dev-name-row";
nameRow.appendChild(nameInput);
nameRow.appendChild(nameSave);
body.appendChild(nameRow);
if (device.inactive) {
var badge = document.createElement("span");
badge.className = "dev-status-badge";
badge.textContent = app.i18nText("badge.inactive", "Inactive");
body.appendChild(devRow(app.i18nText("popup.device_status", "Status"), null, badge));
var reactivateBtn = devBtn(app.i18nText("button.reactivate", "Re-activate"), "primary");
reactivateBtn.onclick = function () {
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "reactivateDevice" })
.then(function (r) {
if (!r.success) { showToast(r.message || "Re-activate failed.", "error"); return; }
showToast(app.i18nText("popup.device_reactivated", "Device re-activated."), "success");
closeDeviceEditModal();
fetchAndDisplayDevices(app);
})
.catch(function (e) { showToast(e.message, "error"); });
};
body.appendChild(devRow(app.i18nText("button.reactivate", "Re-activate"), app.i18nText("popup.reactivate_desc", "Restore controls and position tracking."), reactivateBtn));
} else {
if (hasPos) {
var posSpan = document.createElement("span");
posSpan.style.cssText = "font-size:13px;color:var(--text2);font-family:var(--mono);";
posSpan.textContent = device.position >= 0
? device.position + "% — " + posStateLabel(device.position)
: posStateLabel(-1);
body.appendChild(devRow(app.i18nText("popup.device_position", "Position"), null, posSpan));
}
if (hasFav && device.protocol !== "1w") {
var invertToggle = document.createElement("div");
invertToggle.className = "s-toggle" + (device.is_inverted ? " on" : "");
invertToggle.onclick = function () {
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "invertOpenClose" })
.then(function (r) {
if (!r.success) { showToast(r.message || "Invert failed.", "error"); return; }
device.is_inverted = !device.is_inverted;
invertToggle.classList.toggle("on", device.is_inverted);
showToast(app.i18nText("popup.inverted", "Direction inverted."), "success");
})
.catch(function (e) { showToast(e.message, "error"); });
};
body.appendChild(devRow(
app.i18nText("label.invert_openclose", "Invert open/close"),
app.i18nText("popup.invert_desc", "Swap which end counts as fully open."),
invertToggle
));
}
if (hasPos && device.protocol !== "1w") {
var quietToggle = document.createElement("div");
quietToggle.className = "s-toggle" + (device.is_quiet ? " on" : "");
quietToggle.onclick = function () {
var newVal = !device.is_quiet;
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "setQuiet", value: newVal })
.then(function (r) {
if (!r.success) { showToast(r.message || "Quiet mode failed.", "error"); return; }
device.is_quiet = newVal;
quietToggle.classList.toggle("on", device.is_quiet);
})
.catch(function (e) { showToast(e.message, "error"); });
};
body.appendChild(devRow(
app.i18nText("label.quiet_mode", "Quiet mode"),
app.i18nText("popup.quiet_desc", "Slower, quieter motor operation."),
quietToggle
));
}
if (hasPos) {
var transitSec = device.transit_time_ms > 0 ? Math.round(device.transit_time_ms / 1000) : 0;
var transitSubText = transitSec > 0
    ? app.i18nText("popup.transit_time_s", "{s} s").replace("{s}", transitSec)
    : app.i18nText("popup.transit_not_set", "Not set");

var transitInput = document.createElement("input");
transitInput.type = "number";
transitInput.min = "1";
transitInput.max = "300";
transitInput.className = "s-input";
transitInput.style.width = "64px";
if (transitSec > 0) transitInput.value = transitSec;
transitInput.placeholder = "s";

var transitSaveBtn   = devBtn(app.i18nText("popup.transit_save", "Save"), "primary");
var transitCalBtn    = devBtn(app.i18nText("popup.transit_calibrate", "Calibrate"), "");
var transitCancelBtn = devBtn(app.i18nText("popup.transit_cancel", "Cancel"), "");
transitCancelBtn.style.display = "none";

var transitProgressSpan = document.createElement("span");
transitProgressSpan.style.cssText = "font-size:13px;color:var(--text2);margin-right:8px;";
transitProgressSpan.style.display = "none";

var transitRow = devRow(
    app.i18nText("popup.transit_time", "Transition time"),
    transitSubText,
    [transitProgressSpan, transitInput, transitSaveBtn, transitCalBtn, transitCancelBtn]
);
var transitRowSub = transitRow.querySelector(".dev-row-sub");

function showTransitCalibrating(msg) {
    transitProgressSpan.textContent = msg;
    transitProgressSpan.style.display = "";
    transitCancelBtn.style.display = "";
    transitInput.style.display = "none";
    transitSaveBtn.style.display = "none";
    transitCalBtn.style.display = "none";
}
function showTransitNormal() {
    transitProgressSpan.style.display = "none";
    transitCancelBtn.style.display = "none";
    transitInput.style.display = "";
    transitSaveBtn.style.display = "";
    transitCalBtn.style.display = "";
}

transitSaveBtn.onclick = function () {
    var v = parseInt(transitInput.value, 10);
    if (isNaN(v) || v < 1 || v > 300) { showToast("Enter 1–300 seconds.", "error"); return; }
    window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "setTransitTime", value: v })
        .then(function (r) {
            if (!r.success) { showToast(r.message || "Save failed.", "error"); return; }
            device.transit_time_ms = v * 1000;
            if (transitRowSub) transitRowSub.textContent = app.i18nText("popup.transit_time_s", "{s} s").replace("{s}", v);
            showToast(app.i18nText("popup.transit_saved", "Transition time saved."), "success");
        })
        .catch(function (e) { showToast(e.message, "error"); });
};

if (device.protocol === "1w") {
    transitCalBtn.onclick = function () {
        var startMs = null;
        var extraBtns = [];
        function clearExtra() { extraBtns.forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); }); extraBtns = []; }
        function insertBtn(text, cls, onClick) {
            var b = devBtn(text, cls);
            b.onclick = function () { clearExtra(); onClick(); };
            transitCancelBtn.parentNode.insertBefore(b, transitCancelBtn);
            extraBtns.push(b);
        }
        showTransitCalibrating("Step 1: click ↑ Open, wait for device to open fully.");
        insertBtn("↑ Open", "primary", function () {
            runAction(app, device.id, "open").catch(function () {});
            showTransitCalibrating("Waiting… tap when fully open.");
            insertBtn("✓ Open", "primary", function () {
                startMs = Date.now();
                showTransitCalibrating("Step 2: click ↓ Close, wait for device to close fully.");
                insertBtn("↓ Close", "primary", function () {
                    runAction(app, device.id, "close").catch(function () {});
                    showTransitCalibrating("Waiting… tap when fully closed.");
                    insertBtn("✓ Closed", "primary", function () {
                        var ms = Date.now() - startMs;
                        var s = Math.max(1, Math.round(ms / 1000));
                        window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "setTransitTime", value: s })
                            .then(function (r) {
                                if (!r.success) { showToast(r.message || "Save failed.", "error"); showTransitNormal(); return; }
                                device.transit_time_ms = s * 1000;
                                transitInput.value = s;
                                if (transitRowSub) transitRowSub.textContent = app.i18nText("popup.transit_time_s", "{s} s").replace("{s}", s);
                                showTransitNormal();
                                showToast("Calibration done: " + s + " s", "success");
                            })
                            .catch(function (e) { showToast(e.message, "error"); showTransitNormal(); });
                    });
                });
            });
        });
    };
    transitCancelBtn.onclick = function () { showTransitNormal(); };
} else {
    transitCalBtn.onclick = function () {
        showTransitCalibrating("…");
        window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "calibrate" })
            .then(function (r) {
                if (!r.success) { showTransitNormal(); showToast(r.message || "Calibration failed.", "error"); }
            })
            .catch(function (e) { showTransitNormal(); showToast(e.message, "error"); });
    };
    transitCancelBtn.onclick = function () {
        showTransitNormal();
        window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "cancelCalibration" })
            .catch(function () {});
    };
    window.MiOpenDevices.onCalibrationProgress = function (data) {
        if (data.id !== device.id) return;
        showTransitCalibrating(data.message || "…");
    };
    window.MiOpenDevices.onCalibrationDone = function (data) {
        if (data.id !== device.id) return;
        var s = Math.round(data.transit_time_ms / 1000);
        device.transit_time_ms = data.transit_time_ms;
        transitInput.value = s;
        if (transitRowSub) transitRowSub.textContent = app.i18nText("popup.transit_time_s", "{s} s").replace("{s}", s);
        showTransitNormal();
        showToast(app.i18nText("popup.transit_done", "Calibration done: {s} s").replace("{s}", s), "success");
    };
    window.MiOpenDevices.onCalibrationFailed = function (data) {
        if (data.id !== device.id) return;
        showTransitNormal();
        var cancelled = data.reason === "cancelled";
        showToast(
            cancelled
                ? app.i18nText("popup.transit_cancelled", "Calibration cancelled.")
                : app.i18nText("popup.transit_failed", "Calibration failed."),
            cancelled ? "info" : "error"
        );
    };
}

body.appendChild(transitRow);
if (device.protocol === "1w") {
var resetOpenBtn   = devBtn("0% — Open",    "");
var resetClosedBtn = devBtn("100% — Closed", "");
resetOpenBtn.onclick = function () {
    window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "resetPosition1w", value: 0 })
        .then(function (r) { if (r.success) { device.position = 0; showToast("Position reset to open.", "success"); } else showToast(r.message || "Failed.", "error"); })
        .catch(function (e) { showToast(e.message, "error"); });
};
resetClosedBtn.onclick = function () {
    window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "resetPosition1w", value: 100 })
        .then(function (r) { if (r.success) { device.position = 100; showToast("Position reset to closed.", "success"); } else showToast(r.message || "Failed.", "error"); })
        .catch(function (e) { showToast(e.message, "error"); });
};
body.appendChild(devRow("Reset position", "Force estimated position to a known state.", [resetOpenBtn, resetClosedBtn]));
// Device type selector
var DEVICE_TYPES = [
    [2,"Roller shutter"],[1,"Venetian blind"],[10,"Blind"],[13,"Dual shutter"],
    [3,"Awning"],[16,"Horizontal awning"],[24,"Swinging shutter"],
    [4,"Window opener"],[5,"Garage opener"],[7,"Gate opener"],[8,"Rolling door opener"],
    [6,"Light"],[15,"On/off switch"],[9,"Lock"],[0,"Unknown"]
];
var typeSelect = document.createElement("select");
typeSelect.className = "s-input";
typeSelect.style.cssText = "font-size:12px;padding:4px 8px;";
DEVICE_TYPES.forEach(function(t) {
    var o = document.createElement("option");
    o.value = t[0];
    o.textContent = t[1];
    if (t[0] === device.type) o.selected = true;
    typeSelect.appendChild(o);
});
var typeSaveBtn = devBtn("Save", "primary");
typeSaveBtn.onclick = function () {
    var v = parseInt(typeSelect.value, 10);
    typeSaveBtn.disabled = true;
    window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "setDeviceType", value: v })
        .then(function (r) {
            typeSaveBtn.disabled = false;
            if (r.success) { device.type = v; showToast("Device type saved.", "success"); fetchAndDisplayDevices(app); closeDeviceEditModal(); }
            else showToast(r.message || "Failed.", "error");
        })
        .catch(function (e) { typeSaveBtn.disabled = false; showToast(e.message, "error"); });
};
body.appendChild(devRow("Device type", "Controls which buttons appear in the UI.", [typeSelect, typeSaveBtn]));
// Brand / manufacturer selector
var MANUFACTURERS = [
    [2,"Somfy"],[1,"Velux"],[3,"Honeywell"],[4,"Hörmann"],[5,"Assa Abloy"],
    [6,"Niko"],[7,"Window Master"],[8,"Renson"],[11,"Overkiz"],[12,"Atlantic Group"],[0,"Unknown"]
];
var mfrSelect = document.createElement("select");
mfrSelect.className = "s-input";
mfrSelect.style.cssText = "font-size:12px;padding:4px 8px;";
MANUFACTURERS.forEach(function(m) {
    var o = document.createElement("option");
    o.value = m[0];
    o.textContent = m[1];
    if (m[0] === device.manufacturer_id) o.selected = true;
    mfrSelect.appendChild(o);
});
var mfrSaveBtn = devBtn("Save", "primary");
mfrSaveBtn.onclick = function () {
    var v = parseInt(mfrSelect.value, 10);
    mfrSaveBtn.disabled = true;
    window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "setManufacturer", value: v })
        .then(function (r) {
            mfrSaveBtn.disabled = false;
            if (r.success) { device.manufacturer_id = v; showToast("Brand saved.", "success"); }
            else showToast(r.message || "Failed.", "error");
        })
        .catch(function (e) { mfrSaveBtn.disabled = false; showToast(e.message, "error"); });
};
body.appendChild(devRow("Brand", "Manufacturer of the device.", [mfrSelect, mfrSaveBtn]));
var winkBtn = devBtn("Put in pairing mode", "");
winkBtn.onclick = function () {
    window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "wink1w" })
        .then(function (r) {
            if (r.success) showToast("Device entering pairing mode. Now pair your other remote.", "success");
            else showToast(r.message || "Failed.", "error");
        })
        .catch(function (e) { showToast(e.message, "error"); });
};
body.appendChild(devRow("Put in pairing mode", "Put the device in pairing acceptance mode so other remotes can pair with it.", winkBtn));
}
}
if (hasFav) {
var favPos = getFavPos(device.id);
var favSub = favPos !== null ? "Currently: " + favPos + "%" : "No favorite set.";
var favSetBtn = devBtn(
device.position >= 0 ? t("popup.fav_set_to", {pos: device.position}) : app.i18nText("popup.fav_unknown", "Position unknown"),
""
);
if (device.position < 0) favSetBtn.disabled = true;
var favRow = devRow(app.i18nText("popup.favorite_position", "Favorite position"), favSub, favSetBtn);
favSetBtn.onclick = function () {
setFavPos(device.id, device.position);
updateFavButton(device.id);
var sub = favRow.querySelector(".dev-row-sub");
if (sub) sub.textContent = t("popup.fav_currently", {pos: device.position});
favSetBtn.textContent = t("popup.fav_set_to", {pos: device.position});
showToast(t("popup.fav_saved", {pos: device.position}), "success");
};
body.appendChild(favRow);
}
if (device.protocol !== "1w") {
var idBtn = devBtn(app.i18nText("button.identify", "Identify"), "");
idBtn.onclick = function () {
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "identify" })
.then(function () { showToast(app.i18nText("popup.identifying", "Identify sent — watch for a brief movement."), "info"); })
.catch(function (e) { showToast(e.message, "error"); });
};
body.appendChild(devRow(app.i18nText("button.identify", "Identify"), app.i18nText("popup.device_identify_desc", "Triggers a brief movement to locate the device."), idBtn));
}
}
var danger = document.createElement("div");
danger.className = "dev-danger-zone";
var dangerLbl = document.createElement("div");
dangerLbl.className = "dev-danger-label";
dangerLbl.textContent = app.i18nText("popup.device_danger_zone", "Danger zone");
danger.appendChild(dangerLbl);
if (!device.inactive) {
var deactivateBtn = devBtn(app.i18nText("button.deactivate", "Deactivate"), "danger");
deactivateBtn.onclick = function () {
if (!confirm(app.i18nText("confirm.deactivate_device", "Deactivate \"{name}\"?").replace("{name}", device.name) + "\n"
+ app.i18nText("popup.deactivate_warning", "The device will be kept as inactive and can be re-activated later."))) return;
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "deactivateDevice" })
.then(function (r) {
if (!r.success) { showToast(r.message || "Deactivate failed.", "error"); return; }
showToast(app.i18nText("popup.device_deactivated", "Device deactivated."), "info");
closeDeviceEditModal();
fetchAndDisplayDevices(app);
})
.catch(function (e) { showToast(e.message, "error"); });
};
danger.appendChild(devRow(
app.i18nText("button.deactivate", "Deactivate"),
app.i18nText("popup.deactivate_desc", "Keeps device in list but removes controls. Reversible."),
deactivateBtn
));
}
if (device.protocol === "1w" && !device.inactive) {
var unpairRow = devRow("Unpair", "Send REMOVE frame to the device, then confirm it responded before deleting from storage.", (function () {
var btn = devBtn("Unpair device", "danger");
btn.onclick = function () {
btn.disabled = true;
btn.textContent = "Sending…";
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "sendremove1w" })
.then(function (r) {
if (!r.success) { btn.disabled = false; btn.textContent = "Unpair device"; showToast(r.message || "Failed.", "error"); return; }
var cell = btn.parentElement;
cell.innerHTML = "";
var msg = document.createElement("span");
msg.style.cssText = "font-size:12px;color:var(--text2);";
msg.textContent = "REMOVE sent — did the device confirm?";
cell.appendChild(msg);
var confirmBtn = devBtn("Confirmed ✓", "pair");
var resendBtn  = devBtn("Resend", "");
var cancelBtn  = devBtn("Cancel", "");
confirmBtn.style.marginLeft = "6px";
resendBtn.style.marginLeft  = "4px";
cancelBtn.style.marginLeft  = "4px";
confirmBtn.onclick = function () {
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "deactivateDevice" })
.then(function () { return window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "deleteDevice" }); })
.then(function () { showToast("Device removed.", "info"); closeDeviceEditModal(); fetchAndDisplayDevices(app); })
.catch(function (e) { showToast(e.message, "error"); });
};
resendBtn.onclick = function () {
resendBtn.disabled = true; resendBtn.textContent = "Sending…";
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "sendremove1w" })
.then(function () { resendBtn.disabled = false; resendBtn.textContent = "Resend"; })
.catch(function () { resendBtn.disabled = false; resendBtn.textContent = "Resend"; });
};
cancelBtn.onclick = function () { cell.innerHTML = ""; cell.appendChild(btn); btn.disabled = false; btn.textContent = "Unpair device"; };
cell.appendChild(confirmBtn); cell.appendChild(resendBtn); cell.appendChild(cancelBtn);
})
.catch(function (e) { btn.disabled = false; btn.textContent = "Unpair device"; showToast(e.message, "error"); });
};
return btn;
})());
danger.appendChild(unpairRow);
}
var deleteBtn = devBtn(app.i18nText("button.delete", "Delete permanently"), "danger");
deleteBtn.onclick = function () {
if (!confirm(app.i18nText("confirm.delete_device", "Permanently delete \"{name}\"?").replace("{name}", device.name) + "\n"
+ app.i18nText("popup.delete_warning", "Permanent removal. Cannot be undone — requires factory reset to re-pair."))) return;
var doDelete = function () {
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "deleteDevice" })
.then(function (r) {
if (!r.success) { showToast(r.message || "Delete failed.", "error"); return; }
showToast(app.i18nText("popup.device_deleted", "Device permanently deleted."), "info");
closeDeviceEditModal();
fetchAndDisplayDevices(app);
})
.catch(function (e) { showToast(e.message, "error"); });
};
if (!device.inactive) {
window.MiOpenApi.postJson("/api/action", { deviceId: device.id, action: "deactivateDevice" })
.then(doDelete)
.catch(doDelete);
} else {
doDelete();
}
};
danger.appendChild(devRow(
app.i18nText("popup.device_delete_label", "Delete permanently"),
app.i18nText("popup.delete_warning", "Cannot be undone. Requires factory reset to re-pair."),
deleteBtn
));
body.appendChild(danger);
var closeBtn = document.getElementById("device-edit-close");
if (closeBtn) closeBtn.onclick = closeDeviceEditModal;
modal.onclick = function (e) { if (e.target === modal) closeDeviceEditModal(); };
modal.classList.add("open");
}
async function fetchAndDisplayDevices(app) {
const list = app.elements.deviceList;
if (!list.hasChildNodes()) {
var loadingLi = document.createElement("li");
loadingLi.id = "device-loading";
loadingLi.textContent = app.i18nText("popup.loading", "Loading…");
loadingLi.style.cssText = "padding:20px;color:var(--text3);text-align:center;grid-column:1/-1;";
list.appendChild(loadingLi);
}
try {
const devices = await window.MiOpenApi.requestJson("/api/devices");
app.state.devicesCache = devices;
list.textContent = "";
if (!devices.length) {
app.logStatus(app.i18nText("list.no_devices_found", "No devices found."), "info");
var empty = document.createElement("li");
empty.textContent = app.i18nText("list.no_devices_available", "No devices available.");
empty.style.cssText = "padding:20px;color:var(--text3);text-align:center;grid-column:1/-1;";
list.appendChild(empty);
return;
}
var active   = devices.filter(function (d) { return !d.inactive; });
var inactive = devices.filter(function (d) { return  d.inactive; });
[...active, ...inactive].forEach(function (device) {
var group = getDeviceGroup(device);
var hasPos = (group === "shutter" || group === "venetian" || group === "window");
var li = document.createElement("li");
li.classList.add("device");
li.dataset.id = device.id;
if (device.inactive) li.classList.add("inactive");
var warnDot = document.createElement("div");
warnDot.className = "warn-dot";
li.appendChild(warnDot);
var dot = document.createElement("div");
dot.className = "moving-dot";
li.appendChild(dot);
var top = document.createElement("div");
top.className = "card-top";
var nameBlock = document.createElement("div");
var nameEl = document.createElement("div");
nameEl.className = "card-name";
nameEl.textContent = device.name;
var typeEl = document.createElement("span");
typeEl.className = "card-badge";
typeEl.textContent = (device.type_name || "").toLowerCase();
nameBlock.appendChild(nameEl);
nameBlock.appendChild(typeEl);
if (device.protocol === "1w") {
var badge1w = document.createElement("span");
badge1w.className = "card-badge badge-1w";
badge1w.textContent = "1W";
nameBlock.appendChild(badge1w);
}
var menuBtn = document.createElement("button");
menuBtn.textContent = "⋯";
menuBtn.className = "btn menu";
menuBtn.setAttribute("aria-label", app.i18nText("button.edit", "Edit"));
menuBtn.addEventListener("click", function () { openDeviceEditModal(app, device, group); });
top.appendChild(nameBlock);
top.appendChild(menuBtn);
li.appendChild(top);
if (device.inactive) {
var badge = document.createElement("span");
badge.className = "device-status-only";
badge.textContent = app.i18nText("badge.inactive", "inactive");
li.appendChild(badge);
} else {
if (hasPos) {
li.appendChild(buildPosIndicator(device));
}
var spacer = document.createElement("div");
spacer.className = "card-spacer";
li.appendChild(spacer);
buildControls(app, device, li, group);
if (device.position >= 0) {
updateDeviceFill(device.id, device.position, !!device.is_inverted, !!device.position_estimated);
}
updateDeviceState(device.id, device.is_stopped);
}
list.appendChild(li);
});
var countPill = document.getElementById("count-pill");
if (countPill) countPill.textContent = active.length + " " + (window.t ? window.t("nav.devices") : "devices");
app.logStatus("Device list updated.", "info");
} catch (error) {
app.logStatus("Error fetching devices: " + error.message, "error");
}
}
var pairingWizard = (function () {
var _app = null, _wizard = null, _statusEl = null, _btnsEl = null;
var _badge = null, _scanning = false, _pendingCaptureDeviceId = null;
function open(app) {
_app = app;
_wizard  = document.getElementById("pair-wizard");
_statusEl= document.getElementById("pair-wizard-status");
_btnsEl  = document.getElementById("pair-wizard-buttons");
_badge   = document.getElementById("pairing-badge");
document.getElementById("pair-wizard-close").onclick = cancel;
_wizard.classList.add("open");
showStep1();
}
function close() { if (_wizard) _wizard.classList.remove("open"); hideBadge(); _scanning = false; }
function cancel() {
if (_pendingCaptureDeviceId !== null) {
window.MiOpenApi.postJson("/api/remote/capture/cancel", {}).catch(function () {});
_pendingCaptureDeviceId = null;
}
close();
}
function showBadge(s) {
if (!_badge) return;
var m = Math.floor(s / 60), sc = s % 60;
_badge.textContent = "🔗 " + (m > 0 ? m + "m " : "") + sc + "s";
_badge.style.display = "";
_badge.onclick = function () { if (_wizard) _wizard.classList.add("open"); };
}
function hideBadge() { if (_badge) { _badge.style.display = "none"; _badge.onclick = null; } }
function setStatus(html) { if (_statusEl) _statusEl.innerHTML = html; }
function setButtons(btns) {
if (!_btnsEl) return;
_btnsEl.textContent = "";
btns.forEach(function (b) { _btnsEl.appendChild(b); });
}
function makeBtn(label, cls, onClick) {
var btn = document.createElement("button");
btn.textContent = label; btn.className = cls || "";
btn.addEventListener("click", onClick); return btn;
}
function showStep1() {
_pendingCaptureDeviceId = null; _scanning = false; hideBadge();
_statusEl.innerHTML = "";
var title = document.createElement("p");
title.style.cssText = "font-size:13px;color:var(--text2);margin:0 0 12px;";
title.textContent = "Choose the connection type for this device:";
_statusEl.appendChild(title);
function choiceCard(heading, lines, onClick) {
    var card = document.createElement("div");
    card.style.cssText = "background:var(--surface2);border:1px solid var(--separator);border-radius:10px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:border-color .15s,background .15s;";
    card.onmouseenter = function () { card.style.background = "var(--surface3)"; card.style.borderColor = "var(--blue,#5b9ecf)"; };
    card.onmouseleave = function () { card.style.background = "var(--surface2)"; card.style.borderColor = "var(--separator)"; };
    card.onclick = onClick;
    var h = document.createElement("div");
    h.style.cssText = "font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;";
    h.textContent = heading;
    card.appendChild(h);
    lines.forEach(function (line) {
        var p = document.createElement("div");
        p.style.cssText = "font-size:12px;color:var(--text2);line-height:1.45;";
        p.textContent = line;
        card.appendChild(p);
    });
    return card;
}
_statusEl.appendChild(choiceCard(
    "2W — Bidirectional (most devices)",
    [
        "The device reports its real position back to the controller.",
        "Supports auto-calibration and accurate position tracking.",
        "Required for Somfy RS100 IO, Velux, and similar modern motors."
    ],
    show2wDiscovery
));
_statusEl.appendChild(choiceCard(
    "1W — Simplex (TX only)",
    [
        "Commands are sent only; the device never replies.",
        "Position is estimated by a timer — manual calibration needed.",
        "Used for older or budget motors that do not send status."
    ],
    show1wWizard
));
setButtons([makeBtn(_app.i18nText("button.cancel", "Cancel"), "danger", cancel)]);
}
function show2wDiscovery() {
setStatus(_app.i18nText("popup.pair_step1_text", "Put the device into pairing mode, then press Start."));
setButtons([
makeBtn(_app.i18nText("button.start_discovery", "Start Discovery"), "pair", function () {
_scanning = true; showBadge(120);
setStatus(_app.i18nText("popup.pair_step2_scanning", "Scanning up to 2 minutes...") + " <strong>2m 0s</strong>");
setButtons([makeBtn(_app.i18nText("button.cancel", "Cancel"), "danger", cancel)]);
window.MiOpenApi.postJson("/api/pair/start", {}).catch(function (e) {
_scanning = false; hideBadge();
setStatus(_app.i18nText("popup.pair_failed", "Pairing request failed.") + " " + e.message);
showRetry();
});
}),
makeBtn("Back", "", showStep1),
makeBtn(_app.i18nText("button.cancel", "Cancel"), "danger", cancel)
]);
}
function show1wWizard() {
_statusEl.innerHTML = "";
var desc = document.createElement("p");
desc.style.cssText = "font-size:13px;color:var(--text2);margin:0 0 10px;line-height:1.5;";
desc.textContent = "Put device in pairing mode (hold programming button until LED blinks), enter a name, then click Pair.";
_statusEl.appendChild(desc);
var nameInput = document.createElement("input");
nameInput.type = "text"; nameInput.placeholder = "Device name"; nameInput.maxLength = 31;
nameInput.style.cssText = "width:100%;background:var(--input-bg,var(--surface2));border:1px solid var(--input-border,var(--surface3));border-radius:7px;color:var(--text);padding:8px 12px;font-size:13px;font-family:inherit;outline:none;margin-bottom:6px;display:block;box-sizing:border-box;";
_statusEl.appendChild(nameInput);
function selRow(label, opts) {
var row = document.createElement("div");
row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";
var lbl = document.createElement("span");
lbl.style.cssText = "font-size:11px;color:var(--text3);width:90px;flex-shrink:0;";
lbl.textContent = label;
var sel = document.createElement("select");
sel.style.cssText = "flex:1;background:var(--input-bg,var(--surface2));border:1px solid var(--input-border,var(--surface3));border-radius:6px;color:var(--text);padding:6px 8px;font-size:12px;font-family:inherit;";
opts.forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
row.appendChild(lbl); row.appendChild(sel);
_statusEl.appendChild(row);
return sel;
}
var typeSelect = selRow("Device type", [[0,"All types (default)"],[2,"Roller shutter"],[3,"Awning"],[10,"Blind"]]);
var mfrSelect  = selRow("Manufacturer",  [[2,"Somfy (default)"],[1,"Velux"]]);
setTimeout(function () { nameInput.focus(); }, 50);
setButtons([
makeBtn("Pair", "pair", function () {
var name = nameInput.value.trim();
if (!name) { nameInput.style.borderColor = "var(--red,#c0392b)"; nameInput.focus(); return; }
setStatus("Sending pairing frames…");
setButtons([]);
window.MiOpenApi.postJson("/api/action", { action: "pair1w", name: name, deviceType: parseInt(typeSelect.value, 10), manufacturer: parseInt(mfrSelect.value, 10) })
.then(function (r) {
if (r && r.success && r.deviceId) {
showPairConfirm(r.deviceId, name);
} else {
setStatus("Pairing failed — is the device in pairing mode?");
setButtons([makeBtn("Retry", "pair", show1wWizard), makeBtn("Cancel", "danger", cancel)]);
}
})
.catch(function (e) {
setStatus("Error: " + (e.message || "Unknown error"));
setButtons([makeBtn("Retry", "pair", show1wWizard), makeBtn("Cancel", "danger", cancel)]);
});
}),
makeBtn("Back", "", showStep1),
makeBtn("Cancel", "danger", cancel)
]);
}
function showPairConfirm(deviceId, name) {
setStatus("Pairing frames sent.<br><br>Did the device confirm? (brief jog movement or LED blink)");
function doResend() {
setStatus("Resending…");
setButtons([]);
window.MiOpenApi.postJson("/api/action", { deviceId: deviceId, action: "sendpair1w" })
.then(function () { showPairConfirm(deviceId, name); })
.catch(function (e) { showPairConfirm(deviceId, name); });
}
function doConfirm() {
setStatus("✓ Paired: <strong>" + name + "</strong>");
setButtons([makeBtn("Done", "", cancel)]);
fetchAndDisplayDevices(_app);
}
function doCancel() {
window.MiOpenApi.postJson("/api/action", { deviceId: deviceId, action: "deactivateDevice" })
.then(function () { return window.MiOpenApi.postJson("/api/action", { deviceId: deviceId, action: "deleteDevice" }); })
.catch(function () {})
.finally(function () { cancel(); });
}
setButtons([
makeBtn("Confirmed ✓", "pair", doConfirm),
makeBtn("Resend", "", doResend),
makeBtn("Cancel", "danger", doCancel)
]);
}
function showRetry() {
setButtons([makeBtn(_app.i18nText("button.retry","Retry"),"pair",showStep1), makeBtn(_app.i18nText("button.cancel","Cancel"),"danger",cancel)]);
}
function onPairingActive(remainingS) {
if (!_scanning) return;
showBadge(remainingS);
if (_statusEl && _wizard && _wizard.classList.contains("open")) {
var m = Math.floor(remainingS/60), s = remainingS%60;
_statusEl.innerHTML = _app.i18nText("popup.pair_step2_scanning","Scanning up to 2 minutes...") + " <strong>" + (m>0?m+"m ":"") + s + "s</strong>";
}
}
function onDeviceAdded(deviceId, deviceName) {
if (!_wizard || !_wizard.classList.contains("open")) return;
_scanning = false; hideBadge(); _pendingCaptureDeviceId = deviceId;
setStatus(_app.i18nText("popup.pair_step3_success","Device paired: {name}").replace("{name}", deviceName));
setButtons([
makeBtn(_app.i18nText("button.link_remote","Link Remote"), "pair", function () { startCapture(deviceId); }),
makeBtn(_app.i18nText("button.skip","Done"), "", cancel)
]);
fetchAndDisplayDevices(_app);
}
function onPairFailed(data) {
if (!_wizard || !_wizard.classList.contains("open")) return;
_scanning = false; hideBadge();
if (data && data.status === "key_mismatch") {
setStatus('<span style="color:#c0392b">' + (data.message || _app.i18nText("popup.pair_key_mismatch","Device found but has a different system key. Factory reset the device and try again.")) + '</span>');
} else {
setStatus(_app.i18nText("popup.pair_timeout","No device found."));
}
showRetry();
}
function startCapture(deviceId) {
_pendingCaptureDeviceId = deviceId;
setStatus(_app.i18nText("popup.remote_capture_prompt","Press any button on the remote..."));
setButtons([makeBtn(_app.i18nText("button.cancel","Cancel"), "danger", cancel)]);
window.MiOpenApi.postJson("/api/remote/capture/start", {}).catch(function (e) { setStatus("Capture start failed: " + e.message); showRetry(); });
}
function onRemoteSeen(remoteId) {
if (!_wizard || !_wizard.classList.contains("open")) return;
var devId = _pendingCaptureDeviceId;
setStatus(_app.i18nText("popup.remote_captured","Remote detected: {id}").replace("{id}", remoteId));
setButtons([
makeBtn(_app.i18nText("button.link_remote","Link"), "pair", function () {
window.MiOpenApi.postJson("/api/remote/capture/cancel", {}).catch(function () {});
window.MiOpenApi.postJson("/api/action", { deviceId: devId, action: "linkRemote", remoteId: remoteId })
.then(function () { _app.logStatus("Remote " + remoteId + " linked.", "info"); fetchAndDisplayDevices(_app); cancel(); })
.catch(function (e) { _app.logStatus("Link failed: " + e.message, "error"); });
}),
makeBtn(_app.i18nText("button.skip","Skip"), "", function () { window.MiOpenApi.postJson("/api/remote/capture/cancel", {}).catch(function () {}); cancel(); })
]);
}
function onCaptureTimeout() {
if (!_wizard || !_wizard.classList.contains("open")) return;
var devId = _pendingCaptureDeviceId;
setStatus(_app.i18nText("popup.remote_capture_timeout","No remote detected within 30 seconds."));
setButtons([makeBtn(_app.i18nText("button.retry","Retry"), "pair", function () { startCapture(devId); }), makeBtn(_app.i18nText("button.skip","Done"), "", cancel)]);
}
return { open:open, cancel:cancel, onDeviceAdded:onDeviceAdded, onPairFailed:onPairFailed, onPairingActive:onPairingActive, onRemoteSeen:onRemoteSeen, onCaptureTimeout:onCaptureTimeout };
})();
function openSomfyImportModal(app,dvs){
var m=document.createElement("div");
m.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center;";
var h='<div style="background:var(--card);border-radius:12px;padding:20px;width:min(400px,92vw);max-height:80vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px;"><div style="font-weight:600;font-size:15px;">Devices found in Somfy cloud ('+dvs.length+')</div>';
dvs.forEach(function(d){h+='<label style="display:flex;align-items:center;gap:10px;cursor:'+(d.already_added?'default':'pointer')+';opacity:'+(d.already_added?'.45':'1')+';"><input type="checkbox"'+(d.already_added?' disabled':'')+" data-p='"+JSON.stringify({id:d.id,name:d.name})+"'><span style=\"font-size:13px;\">"+d.name+" · "+d.id+(d.already_added?" (already added)":"")+"</span></label>";});
h+='<div style="display:flex;gap:8px;margin-top:6px;"><button class="s-btn primary" id="_sa">Add selected</button><button class="s-btn" id="_sc">Cancel</button></div></div>';
m.innerHTML=h;document.body.appendChild(m);
m.querySelector("#_sc").onclick=function(){document.body.removeChild(m);};
m.querySelector("#_sa").addEventListener("click",async function(){
var ab=this,sel=[].filter.call(m.querySelectorAll("input[data-p]"),function(c){return c.checked&&!c.disabled;}).map(function(c){return JSON.parse(c.dataset.p);});
if(!sel.length)return;ab.disabled=true;ab.textContent="Adding…";
try{var r=await window.MiOpenApi.postJson("/api/somfy/add",sel);document.body.removeChild(m);app.logStatus(r.message||"Devices added.",r.success?"info":"error");if(r.success)app.fetchAndDisplayDevices();}
catch(e){ab.disabled=false;ab.textContent="Add selected";app.logStatus("Error adding devices.","error");}
});
}
function init(app) {
app.fetchAndDisplayDevices = function () { return fetchAndDisplayDevices(app); };
app.updateDeviceFill  = updateDeviceFill;
app.updateDeviceState = updateDeviceState;
app.pairingWizard     = pairingWizard;
var pairBtn = document.getElementById("pair-device-btn");
if (pairBtn) pairBtn.addEventListener("click", function () { pairingWizard.open(app); });
var _si=document.getElementById("somfy-import-btn");
if(_si)_si.addEventListener("click",async function(){
var s=document.getElementById("somfy-status");
if(s)s.textContent="Contacting Somfy cloud…";_si.disabled=true;
try{var d=await window.MiOpenApi.postJson("/api/somfy/import",{});_si.disabled=false;
if(!Array.isArray(d)){if(s)s.textContent=d&&d.message?d.message:"Import failed.";return;}
if(!d.length){if(s)s.textContent="No io-homecontrol devices found in Somfy account.";return;}
if(s)s.textContent="";openSomfyImportModal(app,d);
}catch(e){_si.disabled=false;if(s)s.textContent="Could not reach Somfy cloud.";}
});
}
window.MiOpenDevices = { init: init };
})();