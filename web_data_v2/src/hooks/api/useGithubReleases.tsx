import useApi, { ApiResponse } from "../useApi";
import { GithubReleaseResponse } from "../../models/Types";

export function useGithubReleases(): ApiResponse<GithubReleaseResponse[]> {
  return useApi<GithubReleaseResponse[]>({
    endpoint: "https://api.github.com/repos/rspaargaren/io-rts-esp32/releases",
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    includeOtaKey: false,
    refreshTime: 300, // Refresh every 5 minutes
  });
}
