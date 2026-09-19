import { Device } from "../models/Types";
import useI18n from "../hooks/useI18n";

const getDeviceGroup = (device: Device) => {
  const type = (device.type_name || "").toLowerCase();

  if (["shutter", "venetian", "window", "gate"].includes(type)) return type;
  if (["awning", "blind"].includes(type)) return type;
  return "other";
};

export function DeviceCard({ device }: { device: Device }) {
  const { t } = useI18n();

  const group = getDeviceGroup(device);
  const hasPos =
    group === "shutter" ||
    group === "venetian" ||
    group === "window" ||
    group === "gate";

  return (
    <li
      key={device.id}
      className={`device ${device.inactive ? "inactive" : ""}`}
      data-id={device.id}
    >
      <div className="warn-dot" />
      <div className="moving-dot" />

      <div className="card-top">
        <div className="nameBlock">
          <div className="card-name">{device.name}</div>
          <span className="card-badge">
            {(device.type_name || "").toLowerCase()}
          </span>

          {device.protocol === "1w" && (
            <span className="card-badge badge-1w">1W</span>
          )}
        </div>

        <button
          type="button"
          className="btn menu"
          aria-label="Edit"
          onClick={() => {
            // replace with your modal open logic
            console.log("Open device edit modal:", device.id);
          }}
        >
          ⋯
        </button>
      </div>

      {device.inactive ? (
        <span className="device-status-only">
          {t ? t("badge.inactive", "inactive") : "inactive"}
        </span>
      ) : (
        <>
          <div class="pos-indicator">
            <div class="pos-top-row">
              <span class="pos-value">0%</span>
              <span class="pos-state">Open</span>
            </div>
            <div class="light-strip">
              <div class="light-fill" style="width: 100%;"></div>
            </div>
          </div>

          <div className="card-spacer" />

          <div class="card-btn-row">
            <button class="card-btn">↑</button>
            <button class="card-btn">■</button>
            <button class="card-btn">↓</button>
            <button
              className="card-btn card-fav"
              aria-label="Favorite"
              title="No favorite set — use Edit to set one."
              data-fav-device="1c611a"
            >
              ★
            </button>
          </div>
          <div class="card-slider-row">
            <span class="card-slider-label">Pos</span>
            <input
              type="range"
              min="0"
              max="100"
              class="card-slider"
              data-slider="position"
            />
          </div>
        </>
      )}
    </li>
  );
}
