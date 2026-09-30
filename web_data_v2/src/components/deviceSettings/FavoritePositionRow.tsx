import { useCallback } from "preact/hooks";
import useI18n from "../../hooks/useI18n";
import { useToast } from "../../hooks/useToast";
import { ToastType } from "../ToastProvider";
import { DeviceRow } from "./DeviceRow";
import { DeviceRowProps, getFavPos, setFavPos } from "./shared";

export function FavoritePositionRow({ device }: DeviceRowProps) {
  const showToast = useToast();
  const { t } = useI18n();
  const favorite = getFavPos(device.id);

  const handleSetFavorite = useCallback(() => {
    if (device.position < 0) return;
    setFavPos(device.id, device.position);
    showToast(
      t("popup.fav_saved")
        ? t("popup.fav_saved")!.replace("{pos}", String(device.position))
        : `Favorite set to ${device.position}%.`,
      ToastType.SUCCESS,
    );
  }, [device.id, device.position, showToast, t]);

  return (
    <DeviceRow
      label={t("popup.favorite_position") || "Favorite position"}
      subLabel={
        favorite
          ? (t("popup.fav_currently") || "Currently: {pos}%").replace(
              "{pos}",
              String(favorite),
            )
          : t("popup.no_favorite_set") || "No favorite set."
      }
    >
      <button
        type="button"
        class="s-btn"
        onClick={handleSetFavorite}
        disabled={device.position < 0}
      >
        {t("popup.fav_set_to")
          ? t("popup.fav_set_to")!.replace("{pos}", String(device.position))
          : `Set to ${device.position}%`}
      </button>
    </DeviceRow>
  );
}

