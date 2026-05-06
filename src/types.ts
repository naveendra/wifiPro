export interface SpeedTestResult {
  id?: string;
  userId: string;
  downloadSpeed: number;
  uploadSpeed: number;
  ping: number;
  unloadedPing: number;
  loadedPing: number;
  wifiName: string;
  isp: string;
  signalStrength: number;
  distance: number;
  location?: {
    lat: number;
    lng: number;
    city: string;
  };
  timestamp: Date;
  isManual: boolean;
}

export interface UserConfig {
  userId: string;
  testInterval: number; // in hours
  lastRun?: Date;
  parallelConnections?: number;
  testDuration?: number;
  measureLoadedLatency?: boolean;
  alwaysShowAllMetrics?: boolean;
}
