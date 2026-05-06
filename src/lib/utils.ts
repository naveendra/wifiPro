import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMbps(speed: number) {
  return speed.toFixed(1);
}

export function formatMs(ping: number) {
  return Math.round(ping);
}

export function getWiFiStrengthLabel(strength: number) {
  if (strength >= 80) return "Excellent";
  if (strength >= 60) return "Good";
  if (strength >= 40) return "Fair";
  return "Poor";
}
