# Device Card Redesign

**Date:** 2026-06-04
**Branch:** main (targets current web_data)

---

## Context

The ui-review.md identified six device card issues. The quick-win batch (commit `4baf580` on `worktree-feat+transit-time`) already resolved three of them (aria-labels, text-overflow, 8px slider). This spec covers the remaining improvements plus landing the quick wins on main.

---

## Changes

### 1. Land quick wins on main

Cherry-pick or merge the changes from `4baf580` that touch device cards:

- `font-family: Arial` → `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
- `aria-label` on open/stop/close/fav buttons
- Device name span: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- Slider height: `4px` → `8px`, add `touch-action: none`

### 2. Replace gear with ⋯ button

**Current:** 25×25px gear icon, `position: absolute; bottom: 6px; right: 6px`, no label, no hover state, `font-size: 0`.

**New:** 26×26px ⋯ button, `position: absolute; top: 6px; right: 6px`.

```css
.btn.menu {
  position: absolute;
  top: 6px;
  right: 6px;
  height: 26px;
  width: 26px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  font-size: 14px;
  font-weight: bold;
  letter-spacing: -1px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn.menu:hover {
  background: rgba(0, 0, 0, 0.4);
}
```

Behaviour: single click opens the existing edit popup — no intermediate dropdown. Same interaction as the gear, just discoverable.

In `devices.js`, change the button creation from:
```js
createDeviceButton(app.i18nText("button.edit", "edit"), "edit", ...)
```
to:
```js
createDeviceButton("⋯", "menu", ...)
```

Remove `.btn.edit` CSS rule; add `.btn.menu` rule above.

### 3. Three-stop soft gradient

**Current:** hard two-stop cut at position.
```css
linear-gradient(to top, var(--color-input) {fill}%, var(--color-accent3) {fill}%)
```

**New:** three-stop blend with a midpoint, softening over ~12% around the position line.

```js
function updateDeviceFill(deviceId, percent, inverted) {
  const deviceEl = document.querySelector('.device[data-id="' + deviceId + '"]');
  if (!deviceEl) return;

  const fill = 100 - percent;
  const mid = Math.min(100, fill + 6);   // midpoint 6% above the cut
  const top = Math.min(100, fill + 12);  // top of blend zone

  const direction = inverted ? "to bottom" : "to top";
  deviceEl.style.background =
    "linear-gradient(" + direction + ", " +
    "var(--color-input) " + (fill - 6) + "%, " +
    "var(--color-muted, #7a3070) " + mid + "%, " +
    "var(--color-accent3) " + top + "%)";

  const slider = deviceEl.querySelector('input[data-slider="position"]');
  if (slider) slider.value = percent;
}
```

The `inverted` parameter flips the gradient direction for devices where `is_openclose_inverted == true`. Pass `device.is_inverted` when calling `updateDeviceFill` from the render loop.

Add a midpoint colour variable to `:root`:
```css
--color-gradient-mid: #7a3070;
```

### 4. Moving state — pulsing glow

Add CSS animation that activates when the `.moving` class is present on the card:

```css
@keyframes card-moving {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.0),
                0 0 8px 1px rgba(106, 3, 96, 0.3);
  }
  50% {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35),
                0 0 16px 4px rgba(106, 3, 96, 0.6);
  }
}

ul#device-list li.device.moving {
  animation: card-moving 1.4s ease-in-out infinite;
}
```

In `devices.js`, after rendering each device, apply or remove the class based on `device.is_stopped`:
```js
listItem.classList.toggle("moving", device.is_stopped === false);
```

Also update `updateDeviceFill` (or add a companion `updateDeviceState`) to toggle `.moving` when WebSocket position events arrive:
```js
function updateDeviceState(deviceId, isStopped) {
  const el = document.querySelector('.device[data-id="' + deviceId + '"]');
  if (el) el.classList.toggle("moving", isStopped === false);
}
```

Wire `updateDeviceState` into the WebSocket event handler in `app.js` wherever position/status updates are dispatched.

### 5. Slider tracks position live

No new code needed — `updateDeviceFill` already sets `slider.value`. Once the transit-time branch merges (which broadcasts estimated intermediate positions over WebSocket), the slider will animate smoothly during movement automatically.

---

## Files Changed

| File | Changes |
|------|---------|
| `web_data/css/style.css` | Add `.btn.menu`, `@keyframes card-moving`, `.device.moving`, `--color-gradient-mid`; remove `.btn.edit` |
| `web_data/js/devices.js` | Replace `"edit"/"⚙"` button with `"menu"/"⋯"`; update `updateDeviceFill` signature to accept `inverted`; add `updateDeviceState`; toggle `.moving` class on render |
| `web_data/js/app.js` | Wire `updateDeviceState` into WebSocket handler |

---

## Out of Scope

- Dropdown menu from ⋯ — direct-to-popup is sufficient; dropdown adds complexity for no gain
- Smooth mid-movement slider animation on `main` — depends on transit-time branch
- Full colour system rename — separate effort, tracked in ui-review.md
