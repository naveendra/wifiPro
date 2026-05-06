import { SpeedTestResult } from "../types";
import { format } from "date-fns";

export interface NetworkInsight {
  type: "success" | "warning" | "info" | "error";
  title: string;
  description: string;
}

export function analyzePerformance(tests: SpeedTestResult[]): NetworkInsight[] {
  if (tests.length < 3) {
    return [{
      type: "info",
      title: "Collecting Data",
      description: "Perform at least 3-5 tests to unlock deep performance insights and ISP anomaly detection."
    }];
  }

  const insights: NetworkInsight[] = [];

  // 1. ISP Reliability Analysis
  const ispStats = tests.reduce((acc, t) => {
    if (!acc[t.isp]) acc[t.isp] = [];
    acc[t.isp].push(t.downloadSpeed);
    return acc;
  }, {} as Record<string, number[]>);

  let bestIsp = "";
  let lowestVariance = Infinity;

  Object.entries(ispStats).forEach(([isp, speeds]) => {
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const max = Math.max(...speeds);
    const min = Math.min(...speeds);
    const variance = ((max - min) / (avg || 1)) * 100;

    if (variance < lowestVariance && speeds.length >= 2) {
      lowestVariance = variance;
      bestIsp = isp;
    }

    if (variance > 60) {
      insights.push({
        type: "warning",
        title: `${isp} Instability`,
        description: `High performance swing detected (${variance.toFixed(0)}%). Consider checking for line noise or peak-hour congestion.`
      });
    }
  });

  if (bestIsp) {
    insights.push({
      type: "success",
      title: "Most Reliable ISP",
      description: `${bestIsp} shows the most consistent speeds with only ${lowestVariance.toFixed(0)}% performance variance.`
    });
  }

  // 2. Distance Correlation Analysis
  const distSpeeds = tests.filter(t => t.distance > 0);
  if (distSpeeds.length >= 3) {
    const nearTests = distSpeeds.filter(t => t.distance <= 2);
    const farTests = distSpeeds.filter(t => t.distance > 5);

    if (nearTests.length > 0 && farTests.length > 0) {
      const nearAvg = nearTests.reduce((a, b) => a + b.downloadSpeed, 0) / nearTests.length;
      const farAvg = farTests.reduce((a, b) => a + b.downloadSpeed, 0) / farTests.length;
      const drop = ((nearAvg - farAvg) / nearAvg) * 100;

      if (drop > 30) {
        insights.push({
          type: "error",
          title: "Signal Attenuation",
          description: `You lose ${drop.toFixed(0)}% speed when moving >5m away. Consider a Wi-Fi mesh system or repositioning your router.`
        });
      }
    }
  }

  // 3. Peak Hour Detection
  const hourlySpeeds = tests.reduce((acc, t) => {
    const hour = t.timestamp.getHours();
    if (!acc[hour]) acc[hour] = [];
    acc[hour].push(t.downloadSpeed);
    return acc;
  }, {} as Record<number, number[]>);

  const hourAvgs = Object.entries(hourlySpeeds).map(([hour, speeds]) => ({
    hour: parseInt(hour),
    avg: speeds.reduce((a, b) => a + b, 0) / speeds.length
  })).sort((a, b) => b.avg - a.avg);

  if (hourAvgs.length > 0) {
    const bestHour = hourAvgs[0].hour;
    const timeStr = format(new Date().setHours(bestHour, 0), "HH:mm");
    insights.push({
      type: "info",
      title: "Optimized Window",
      description: `Historical data shows peak performance typically around ${timeStr}. Best for heavy downloads.`
    });
  }

  // 4. ISP Throttling Detection
  const recentTest = tests[0];
  const hour = recentTest.timestamp.getHours();
  const isPeakHour = hour >= 18 && hour <= 23;
  
  const ispAvg = ispStats[recentTest.isp].reduce((a, b) => a + b, 0) / ispStats[recentTest.isp].length;
  const dropPercentage = ((ispAvg - recentTest.downloadSpeed) / ispAvg) * 100;

  if (dropPercentage > 50) {
    insights.push({
      type: "error",
      title: "Suspected ISP Throttling",
      description: `Speed is ${dropPercentage.toFixed(0)}% below your ISP's usual average. This level of degradation often indicates active traffic management.`
    });
  } else if (isPeakHour && dropPercentage > 35) {
    insights.push({
      type: "warning",
      title: "Peak Hour Throttling",
      description: `Significant speed drop (${dropPercentage.toFixed(0)}%) detected during evening peak hours (18:00-23:00). Common behavior for heavily shared node connections.`
    });
  } else if (recentTest.signalStrength > 80 && recentTest.downloadSpeed < ispAvg * 0.5) {
    insights.push({
      type: "warning",
      title: "Performance Disparity",
      description: "Low speeds detected despite excellent signal strength. This discrepancy strongly suggests bandwidth limiting at the ISP level."
    });
  }

  // 5. Anomaly Detection (Generic recent drops)
  const historicalAvg = tests.reduce((a, b) => a + b.downloadSpeed, 0) / tests.length;
  
  if (recentTest.downloadSpeed < historicalAvg * 0.4 && dropPercentage <= 50) {
    insights.push({
      type: "error",
      title: "Performance Anomaly",
      description: `Latest test is substantially below your overall network baseline. Potential external network issue.`
    });
  }

  return insights;
}
