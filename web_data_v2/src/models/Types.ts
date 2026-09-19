export interface WifiConfig {
  ssid: string;
  password: string;
}

export interface otaKeyResponse {
  key: string;
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
  inactive?: boolean;
  protocol?: string;
  type_name?: string;
  manufacturer?: string;
  position?: number;
  is_inverted?: boolean;
  position_estimated?: boolean;
  is_stopped?: boolean;
  device?: Device;
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
