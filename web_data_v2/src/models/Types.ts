export interface WifiConfig {
  ssid: string;
  password: string;
}

export interface Key {
  key: string;
}

export interface GithubReleaseResponse {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  assets: GithubReleaseAsset[];
}

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface NetworkConfig {
  hostname: string;
  dhcp: boolean;
  ip: string;
  mask: string;
  gateway: string;
  dns1: string;
  dns2: string;
  sntp: string;
  actual_ip: string;
  actual_mask: string;
  actual_gateway: string;
  actual_dns1: string;
}

export interface FallBackConfig {
  enabled: boolean;
  retries_boot: number;
  retries_running: number;
  ap_timeout_s: number;
  ap_ssid: string;
  ap_running: boolean;
  connected: boolean;
}

export interface IoConfig {
  node_id: string;
  tx_power: number;
  passive_mode: boolean;
}

export interface MqttConfig {
  user: string;
  server: string;
  port: number;
  password: string;
  client_id: string;
  topic: string;
  discovery: string;
  connected: boolean;
  enabled: boolean;
  status: string;
}
export interface Remote {
  id: string;
  name: string;
  devices: string[];
}

export interface ActionResult {
  success?: boolean;
  message?: string;
}

export interface Device {
  id: string;
  name: string;
  inactive: boolean;
  position: number;
  tilt: number;
  type: number;
  type_name: string;
  subtype: number;
  manufacturer: string;
  manufacturer_id: number;
  is_low_power: boolean;
  is_stopped: boolean;
  is_inverted: boolean;
  is_quiet: boolean;
  tilt_supported: boolean;
  transit_time_ms: number;
  protocol: string;
  position_estimated: boolean;
}

export interface WifiScanResult {
  ssid: string;
  rssi: number;
  auth: number;
}

export interface SomfyConfig {
  email: string;
  password: string;
}

export interface SyslogConfig {
  enabled: boolean;
  server: string;
  port: number;
  facility: number;
  min_level: number;
  id: string;
  format: string;
}

export interface InfoResponse {
  version: string;
  project: string;
  compile_date: string;
  compile_time: string;
  idf_ver: string;
  board: string;
  web_version: string;
}
