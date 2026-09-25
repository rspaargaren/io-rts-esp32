import { useEffect, useMemo, useState } from "preact/hooks";
import { useGithubReleases } from "../hooks/api/useGithubReleases";
import { useInfo } from "../hooks/api/useInfo";
import { GithubReleaseResponse } from "../models/Types";

const DISMISSED_KEY = "updateDismissed";
const CHANNEL_KEY = "updateChannel";
const DEFAULT_CHANNEL = "stable";

type UpdateStatus = {
  label: string;
  progress: number | null;
};

function parseVersion(tag: string | undefined): string | null {
  return tag && /^v\d+\.\d+\.\d+/.test(tag) ? tag : null;
}

function isNewer(
  latest: string | undefined,
  current: string | undefined,
): boolean {
  const latestVersion = parseVersion(latest);
  const currentVersion = parseVersion(current);
  if (!latestVersion || !currentVersion) return false;

  const latestParts = latestVersion
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map(Number);
  const currentParts = currentVersion
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map(Number);
  for (let i = 0; i < 3; i += 1) {
    const latestPart = latestParts[i] || 0;
    const currentPart = currentParts[i] || 0;
    if (latestPart !== currentPart) return latestPart > currentPart;
  }
  return false;
}

function findAssetUrl(
  release: GithubReleaseResponse,
  name: string,
): string | null {
  return (
    release.assets.find((asset) => asset.name === name)?.browser_download_url ||
    null
  );
}

async function pollUntilOnline(deadline: number): Promise<void> {
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(`/api/info?${Date.now()}`, {
        cache: "no-store",
      });
      if (response.ok) return;
    } catch {
      // The device is expected to be unreachable while it reboots.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  throw new Error("Timed out waiting for device after update");
}

async function otaFromUrl(
  url: string,
  type: "firmware" | "web",
  otaKey: string,
  onStatus: (status: string) => void,
): Promise<void> {
  onStatus(`Device downloading ${type}…`);
  const response = await fetch("/api/ota/url", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OTA-Key": otaKey },
    body: JSON.stringify({ url, type }),
  });
  const text = await response.text();
  let data: { status?: string; message?: string };
  try {
    data = JSON.parse(text) as { status?: string; message?: string };
  } catch {
    throw new Error(
      `Server returned unexpected response: ${text.substring(0, 120)}`,
    );
  }
  if (data.status === "rebooting") {
    onStatus("Rebooting…");
    return;
  }
  throw new Error(data.message || "Unexpected response");
}

export function FirmwareUpdater() {
  const releases = useGithubReleases();
  const info = useInfo();
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY),
  );
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  const release = useMemo(() => {
    const channel = localStorage.getItem(CHANNEL_KEY) || DEFAULT_CHANNEL;
    return releases.data?.find((candidate) => {
      if (candidate.draft || (candidate.prerelease && channel === "stable"))
        return false;
      return !!parseVersion(candidate.tag_name);
    });
  }, [releases.data]);

  const currentVersion = info.data?.version;
  const isAvailable =
    !!release &&
    release.tag_name !== dismissed &&
    isNewer(release.tag_name, currentVersion);

  useEffect(() => {
    if (releases.isError || info.isError)
      setError("Could not check for updates.");
  }, [releases.isError, info.isError]);

  const dismiss = () => {
    if (!release) return;
    localStorage.setItem(DISMISSED_KEY, release.tag_name);
    setDismissed(release.tag_name);
  };

  const startUpdate = async () => {
    if (!release || !info.data || updating) return;
    const firmwareUrl = findAssetUrl(
      release,
      `${info.data.board}-${release.tag_name}-firmware.bin`,
    );
    const webUrl = findAssetUrl(
      release,
      `${info.data.board}-${release.tag_name}-web.bin`,
    );
    if (!firmwareUrl || !webUrl) {
      setError(
        `Release assets not found for board "${info.data.board}". Please update manually.`,
      );
      return;
    }

    setUpdating(true);
    setError("");
    setStatus({ label: "Starting update…", progress: 0 });
    try {
      const keyResponse = await fetch(`/api/ota/key?${Date.now()}`, {
        cache: "no-store",
      });
      if (!keyResponse.ok) throw new Error("Failed to retrieve OTA key.");
      const keyData = (await keyResponse.json()) as { key?: string };
      if (!keyData.key) throw new Error("Failed to retrieve OTA key.");

      try {
        await otaFromUrl(firmwareUrl, "firmware", keyData.key, (label) =>
          setStatus({ label, progress: 25 }),
        );
      } catch (updateError) {
        if (!(updateError instanceof TypeError)) throw updateError;
        setStatus({ label: "Rebooting…", progress: null });
      }
      setStatus({
        label: "Waiting for device to come back online…",
        progress: null,
      });
      await pollUntilOnline(Date.now() + 60000);
      try {
        await otaFromUrl(webUrl, "web", keyData.key, (label) =>
          setStatus({ label, progress: 75 }),
        );
      } catch (updateError) {
        if (!(updateError instanceof TypeError)) throw updateError;
        setStatus({ label: "Rebooting…", progress: null });
      }
      setStatus({
        label: "Waiting for device to come back online…",
        progress: null,
      });
      await pollUntilOnline(Date.now() + 60000);
      let webVersion = "";
      try {
        const response = await fetch(`/api/info?${Date.now()}`, {
          cache: "no-store",
        });
        const latestInfo = (await response.json()) as { web_version?: string };
        webVersion = latestInfo.web_version
          ? ` (web ${latestInfo.web_version})`
          : "";
      } catch {
        // The update succeeded even if the final informational request fails.
      }
      setStatus({
        label: `Update complete${webVersion}! Reloading…`,
        progress: 100,
      });
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (updateError) {
      setError(
        `Update failed: ${updateError instanceof Error ? updateError.message : "unknown error"}`,
      );
      setStatus(null);
      setUpdating(false);
    }
  };

  if (!isAvailable || !release) return null;

  return (
    <div id="update-banner">
      <div class="update-banner-inner">
        <div class="update-banner-info">
          <span class="update-banner-version">
            Update available: {release.prerelease ? "Beta" : "Stable"}{" "}
            {release.tag_name}
          </span>
          <a
            class="update-banner-link"
            target="_blank"
            rel="noopener"
            href={release.html_url}
          >
            What's new
          </a>
        </div>
        <div class="update-banner-actions">
          {!updating && (
            <button class="update-banner-dismiss" onClick={dismiss}>
              ✕
            </button>
          )}
          <button
            class="update-banner-btn"
            disabled={updating}
            onClick={startUpdate}
          >
            {updating ? "Updating…" : "Update"}
          </button>
        </div>
      </div>
      {status && (
        <div class="update-progress">
          <div class="update-progress-label">{status.label}</div>
          {status.progress !== null && (
            <progress
              class="update-progress-bar"
              max="100"
              value={status.progress}
            />
          )}
        </div>
      )}
      {error && <div class="update-progress-label">{error}</div>}
    </div>
  );
}
