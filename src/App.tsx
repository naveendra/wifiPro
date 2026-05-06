import React, { useState, useEffect } from "react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell
} from "recharts";
import { 
  Activity, 
  Wifi, 
  Download, 
  Upload, 
  Zap, 
  Clock, 
  BarChart3, 
  Settings, 
  DownloadIcon, 
  Trash2, 
  MapPin,
  RefreshCw,
  Radio,
  LogOut,
  CheckCircle,
  Info,
  Smartphone,
  SignalHigh,
  SignalMedium,
  SignalLow,
  WifiOff
} from "lucide-react";
import { auth, signInWithGoogle, logout } from "./lib/firebase";
import { speedTestService, measureSpeed, getISPInfo, getGeoLocation, runLiveMonitor, LiveQualityData } from "./services/speedTestService";
import { SpeedTestResult, UserConfig } from "./types";
import { formatMbps, formatMs, cn } from "./lib/utils";
import { analyzePerformance, NetworkInsight } from "./lib/analytics";
import { motion, AnimatePresence } from "motion/react";
import { format } from "date-fns";

export default function App() {
  const [user, setUser] = useState(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const [tests, setTests] = useState<SpeedTestResult[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [config, setConfig] = useState<UserConfig>({ userId: "", testInterval: 1 });
  const [activeTab, setActiveTab] = useState<"dashboard" | "trends" | "optimizer" | "settings">("dashboard");

  // Live Optimizer state
  const [isLiveMonitoring, setIsLiveMonitoring] = useState(false);
  const [liveData, setLiveData] = useState<LiveQualityData | null>(null);
  const [liveHistory, setLiveHistory] = useState<LiveQualityData[]>([]);
  const [peakScore, setPeakScore] = useState<{ score: number, timestamp: Date } | null>(null);

  useEffect(() => {
    let stopMonitor: (() => void) | undefined;
    if (isLiveMonitoring) {
      setPeakScore(null);
      stopMonitor = runLiveMonitor((data) => {
        setLiveData(data);
        setLiveHistory(prev => [...prev.slice(-30), data]);
        setPeakScore(currentPeak => {
          if (!currentPeak || data.score > currentPeak.score) {
            return { score: data.score, timestamp: new Date() };
          }
          return currentPeak;
        });
      });
    } else {
      setLiveData(null);
      setLiveHistory([]);
    }
    return () => stopMonitor?.();
  }, [isLiveMonitoring]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      const unsub = speedTestService.subscribeToTests(setTests);
      speedTestService.getUserConfig().then((c) => {
        if (c) {
          setConfig(c);
        } else {
          // Initialize config for new user
          const initialConfig = { userId: user.uid, testInterval: 1 };
          speedTestService.saveUserConfig(initialConfig);
          setConfig(initialConfig);
        }
      });
      return () => unsub();
    }
  }, [user]);

  // Pseudo-background task
  useEffect(() => {
    if (!user || config.testInterval <= 0) return;

    const checkAndRun = async () => {
      const now = new Date();
      if (!config.lastRun || (now.getTime() - new Date(config.lastRun).getTime()) > (config.testInterval * 3600000)) {
        await handleRunTest(false);
      }
    };

    const interval = setInterval(checkAndRun, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [user, config]);

  const [showConditionsModal, setShowConditionsModal] = useState(false);
  const [testConditions, setTestConditions] = useState({ 
    wifiName: "Auto Detect", 
    signalStrength: 100, 
    distance: 1,
    connectionType: 'wifi' as 'wifi' | 'cellular' | 'ethernet' | 'unknown',
    networkType: 'LTE' as string // 4G, 5G, etc.
  });

  useEffect(() => {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      const updateConnection = () => {
        const type = connection.type || 'unknown';
        const effectiveType = (connection.effectiveType || '').toUpperCase();
        
        setTestConditions(prev => ({ 
          ...prev, 
          connectionType: type,
          networkType: effectiveType || (type === 'cellular' ? 'LTE' : 'WiFi')
        }));

        if (type === 'cellular') {
          // Estimate strength based on downlink property (rough approximation for browser)
          const strength = Math.min(100, (connection.downlink || 5) * 8);
          setTestConditions(prev => ({ ...prev, signalStrength: Math.round(strength) }));
        }
      };
      connection.addEventListener('change', updateConnection);
      updateConnection();
      return () => connection.removeEventListener('change', updateConnection);
    }
  }, []);

  const handleRunTest = async (isManual = true) => {
    if (isTesting) return;
    setIsTesting(true);
    setShowConditionsModal(false);
    try {
      const ispInfo = await getISPInfo();
      const location = await getGeoLocation();
      const results = await measureSpeed({
        parallelConnections: config.parallelConnections,
        testDuration: config.testDuration,
        measureLoadedLatency: config.measureLoadedLatency
      });
      
      const newTest: SpeedTestResult = {
        downloadSpeed: results.download,
        uploadSpeed: results.upload,
        ping: results.ping,
        unloadedPing: results.unloadedPing,
        loadedPing: results.loadedPing,
        wifiName: testConditions.wifiName,
        isp: ispInfo.isp,
        signalStrength: testConditions.signalStrength,
        distance: testConditions.distance,
        isManual,
        userId: user!.uid,
        timestamp: new Date()
      };

      if (location) {
        newTest.location = { 
          lat: location.lat, 
          lng: location.lng, 
          city: ispInfo.city || "Unknown"
        };
      }

      await speedTestService.logTest(newTest);
      await speedTestService.saveUserConfig({ lastRun: speedTestService.serverTimestamp() as any });
      setConfig(prev => ({ ...prev, lastRun: new Date() }));
    } catch (err) {
      console.error("Test failed", err);
    } finally {
      setIsTesting(false);
    }
  };

  const exportData = () => {
    const csvRows = [
      ["Timestamp", "Download (Mbps)", "Upload (Mbps)", "Ping (ms)", "ISP", "WiFi", "Signal (%)", "Distance (m)", "Manual"],
      ...tests.map(t => [
        t.timestamp.toISOString(),
        t.downloadSpeed.toFixed(2),
        t.uploadSpeed.toFixed(2),
        t.ping.toFixed(0),
        t.isp,
        t.wifiName,
        t.signalStrength,
        t.distance,
        t.isManual
      ])
    ];

    const csvContent = csvRows.map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `speed_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white font-mono">
        <div className="flex flex-col items-center gap-4">
          <Activity className="animate-pulse text-cyan-500 w-12 h-12" />
          <p className="text-xs uppercase tracking-widest opacity-50">Initializing Pulse...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_#111_0%,_#0a0a0a_100%)]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-[#151515] border border-white/5 p-8 rounded-3xl shadow-2xl text-center"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-500/10 rounded-full mb-6">
            <Zap className="text-cyan-500 w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 font-sans tracking-tight">LankaSpeed Pulse</h1>
          <p className="text-gray-400 text-sm mb-8 leading-relaxed">
            Monitor your internet performance, identify ISP throttle patterns, and optimize your connectivity in Sri Lanka.
          </p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-white text-black font-semibold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-gray-100 transition-all active:scale-[0.98]"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/instrumentation/google.svg" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  const latestTest = tests[0];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-cyan-500/30">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/5 z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center italic font-black text-black text-sm">LP</div>
          <span className="font-bold tracking-tight hidden sm:block">LANKASPEED <span className="text-cyan-500">PULSE</span></span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex gap-4">
            <NavIcon active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Activity size={20} />} label="Dash" />
            <NavIcon active={activeTab === 'trends'} onClick={() => setActiveTab('trends')} icon={<BarChart3 size={20} />} label="Trends" />
            <NavIcon active={activeTab === 'optimizer'} onClick={() => setActiveTab('optimizer')} icon={<Radio size={20} />} label="Optimizer" />
            <NavIcon active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings size={20} />} label="Config" />
          </div>
          <div className="h-4 w-px bg-white/10" />
          <button onClick={logout} className="p-2 hover:bg-white/5 rounded-full transition-colors opacity-60 hover:opacity-100">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-6xl mx-auto overflow-x-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dash"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              {/* Main Hero Stat */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-[#151515] rounded-[32px] p-8 border border-white/5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-10">
                    <Wifi size={120} />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h2 className="text-sm font-medium text-white/50 uppercase tracking-widest mb-1">Current Speed</h2>
                        <div className="flex items-center gap-2">
                          <span className="text-cyan-500 animate-pulse text-xs uppercase font-bold tracking-tighter">Live Monitor</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => setShowConditionsModal(true)} 
                        disabled={isTesting}
                        className={cn(
                          "px-6 py-3 rounded-2xl flex items-center gap-2 font-bold transition-all",
                          isTesting 
                            ? "bg-white/5 text-white/20 cursor-not-allowed" 
                            : "bg-cyan-500 text-black hover:bg-cyan-400 active:scale-95 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                        )}
                      >
                        {isTesting ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
                        {isTesting ? "Testing..." : "New Pulse"}
                      </button>
                    </div>

                    <AnimatePresence>
                      {showConditionsModal && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="absolute inset-x-0 bottom-0 bg-[#1a1a1a] p-8 border-t border-white/10 z-20 rounded-t-3xl shadow-2xl"
                        >
                          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                             <Wifi className="text-cyan-500" /> Confirm Context
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold tracking-widest text-white/30">Network Label</label>
                                <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 border border-white/5">
                                  {testConditions.connectionType === 'cellular' ? <Smartphone size={10} className="text-cyan-500" /> : <Wifi size={10} className="text-cyan-500" />}
                                  <span className="text-[8px] font-black uppercase text-white/40">
                                    {testConditions.connectionType === 'cellular' ? testConditions.networkType : 'WiFi'}
                                  </span>
                                </div>
                              </div>
                              <input 
                                type="text" 
                                value={testConditions.wifiName}
                                onChange={(e) => setTestConditions(prev => ({ ...prev, wifiName: e.target.value }))}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50"
                                placeholder={testConditions.connectionType === 'cellular' ? "Carrier Name" : "e.g. SLT-Fiber-5G"}
                              />
                            </div>
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="text-[10px] uppercase font-bold tracking-widest text-white/30">
                                  {testConditions.connectionType === 'cellular' ? "Signal Strength" : "WiFi Signal Health"}
                                </label>
                                <div className="flex items-center gap-2">
                                  <div className="flex items-end gap-[2px] h-4 bg-white/5 p-1.5 rounded-lg border border-white/5">
                                    {[1, 2, 3, 4, 5].map((bar) => {
                                      const threshold = bar * 20;
                                      const isActive = testConditions.signalStrength >= threshold || (bar === 1 && testConditions.signalStrength > 0);
                                      const strengthColor = 
                                        testConditions.signalStrength >= 80 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" :
                                        testConditions.signalStrength >= 40 ? "bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.4)]" :
                                        "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]";
                                      
                                      return (
                                        <div 
                                          key={bar} 
                                          className={cn(
                                            "w-1.5 rounded-sm transition-all duration-300",
                                            bar === 1 && "h-1.5",
                                            bar === 2 && "h-2.5",
                                            bar === 3 && "h-3.5",
                                            bar === 4 && "h-4.5",
                                            bar === 5 && "h-5.5",
                                            isActive ? strengthColor : "bg-white/10"
                                          )} 
                                        />
                                      );
                                    })}
                                  </div>
                                  <span className={cn(
                                    "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md",
                                    testConditions.signalStrength >= 80 ? "text-green-400 bg-green-400/10" : 
                                    testConditions.signalStrength >= 40 ? "text-yellow-400 bg-yellow-400/10" : 
                                    "text-red-400 bg-red-400/10"
                                  )}>
                                    {testConditions.signalStrength >= 90 ? "Excellent" :
                                     testConditions.signalStrength >= 70 ? "Good" :
                                     testConditions.signalStrength >= 50 ? "Stable" :
                                     testConditions.signalStrength >= 30 ? "Fair" : "Poor"}
                                  </span>
                                </div>
                              </div>
                              
                              <div className="bg-white/5 p-4 rounded-3xl border border-white/5 space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex flex-col">
                                    <span className="text-xl font-black font-mono tracking-tighter">{testConditions.signalStrength}%</span>
                                    <span className="text-[9px] uppercase font-bold text-white/30 tracking-widest">Signal Strength</span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className={cn(
                                      "text-xl font-black font-mono tracking-tighter",
                                      testConditions.signalStrength < 40 ? "text-red-400" : "text-white/40"
                                    )}>
                                      {Math.max(5, 100 - testConditions.signalStrength + Math.floor(Math.random() * 5))}%
                                    </span>
                                    <span className="text-[9px] uppercase font-bold text-white/30 tracking-widest">Est. Interference</span>
                                  </div>
                                </div>

                                {/* Spectrum Visualizer */}
                                <div className="relative h-6 bg-white/5 rounded-full overflow-hidden border border-white/5 flex items-center px-1">
                                  <div 
                                    className={cn(
                                      "h-4 rounded-full transition-all duration-700 relative z-10",
                                      testConditions.signalStrength >= 70 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : 
                                      testConditions.signalStrength >= 40 ? "bg-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.5)]" : 
                                      "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                                    )}
                                    style={{ width: `${testConditions.signalStrength}%` }}
                                  />
                                  <div 
                                    className="absolute right-0 top-0 bottom-0 bg-red-500/20 animate-pulse"
                                    style={{ width: `${Math.max(5, 100 - testConditions.signalStrength)}%` }}
                                  />
                                  <div className="absolute inset-0 flex justify-around items-center opacity-10 pointer-events-none">
                                    {[...Array(10)].map((_, i) => <div key={i} className="w-px h-2 bg-white" />)}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                  <input 
                                    type="range" 
                                    min="0" max="100"
                                    value={testConditions.signalStrength}
                                    onChange={(e) => setTestConditions(prev => ({ ...prev, signalStrength: parseInt(e.target.value) }))}
                                    className="flex-1 h-3 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
                                  />
                                </div>

                                {testConditions.signalStrength < 50 && (
                                  <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-2xl flex gap-3 items-start">
                                    <div className="p-1.5 bg-red-500/20 rounded-lg">
                                      <SignalLow size={14} className="text-red-400" />
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-[10px] font-bold text-red-300 uppercase tracking-wider">Interference Alert</span>
                                      <p className="text-[9px] text-red-300/60 leading-tight">High noise floor detected. Potential packet loss due to wall density or electronic interference.</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] uppercase font-bold tracking-widest text-white/30">Distance from Router (meters)</label>
                              <div className="relative">
                                <input 
                                  type="number" 
                                  min="0"
                                  value={testConditions.distance}
                                  onChange={(e) => setTestConditions(prev => ({ ...prev, distance: parseFloat(e.target.value) || 0 }))}
                                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500/50 pr-12"
                                  placeholder="0.0"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-white/20">Meters</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-3">
                            <button 
                              onClick={() => handleRunTest(true)}
                              className="flex-1 bg-cyan-500 text-black py-3 rounded-xl font-bold hover:bg-cyan-400"
                            >
                              Start Speed Pulse
                            </button>
                            <button 
                              onClick={() => setShowConditionsModal(false)}
                              className="px-6 py-3 bg-white/5 rounded-xl font-bold hover:bg-white/10"
                            >
                              Cancel
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex flex-col sm:flex-row items-baseline gap-4 mb-2">
                       <span className="text-8xl font-black tracking-tighter leading-none">
                         {latestTest ? formatMbps(latestTest.downloadSpeed) : "0.0"}
                       </span>
                       <div className="flex flex-col">
                         <span className="text-2xl font-bold text-white/30 uppercase">Mbps</span>
                         {analyzePerformance(tests).some(i => i.title.includes("Throttling")) && (
                           <motion.div 
                             initial={{ opacity: 0, scale: 0.8 }}
                             animate={{ opacity: 1, scale: 1 }}
                             className="mt-1 flex items-center gap-1.5 px-2 py-0.5 bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg"
                           >
                             <Zap size={10} className="fill-current" />
                             <span className="text-[10px] font-black uppercase tracking-tighter">Throttling Suspected</span>
                           </motion.div>
                         )}
                       </div>
                    </div>
                    <p className="text-white/40 text-sm max-w-md">
                      {latestTest 
                        ? `Last test recorded on ${format(latestTest.timestamp, 'MMM d, h:mm a')} via ${latestTest.isp}`
                        : "No test data available yet."}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <MiniStatCard icon={<Upload className="text-green-500" />} label="Upload" value={latestTest ? formatMbps(latestTest.uploadSpeed) : "0.0"} unit="Mbps" />
                  <div className="bg-[#151515] rounded-3xl p-6 border border-white/5 group hover:border-white/10 transition-all">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-white/10 transition-all">
                        <Clock className="text-yellow-500" size={20} />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold tracking-widest text-white/30">Latency</p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black">{latestTest ? formatMs(latestTest.ping).toString() : "0"}</span>
                          <span className="text-xs font-bold text-white/20 uppercase">ms</span>
                        </div>
                      </div>
                    </div>
                    {latestTest && (
                      <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
                        <div>
                          <p className="text-[8px] uppercase font-bold text-white/20 tracking-widest">Unloaded</p>
                          <p className="text-sm font-bold text-white/60">{formatMs(latestTest.unloadedPing)}ms</p>
                        </div>
                        <div>
                          <p className="text-[8px] uppercase font-bold text-white/20 tracking-widest">Loaded</p>
                          <p className="text-sm font-bold text-white/60">{formatMs(latestTest.loadedPing)}ms</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="bg-[#151515] rounded-3xl p-6 border border-white/5">
                    <div className="flex items-center gap-3 mb-4">
                      <MapPin className="text-purple-500" size={20} />
                      <span className="text-sm font-medium text-white/50 uppercase tracking-wider">ISP Context</span>
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold text-lg leading-tight">{latestTest?.isp || "Unknown ISP"}</p>
                      <p className="text-white/30 text-sm">Sri Lanka Region</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent History Table */}
              <div className="bg-[#151515] rounded-[32px] border border-white/5 overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <h3 className="font-bold text-lg">Activity Log</h3>
                  <button 
                    onClick={exportData}
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-500 hover:text-cyan-400"
                  >
                    <DownloadIcon size={14} />
                    Export CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono">
                    <thead className="bg-white/5 text-[10px] text-white/30 uppercase tracking-[0.2em]">
                      <tr>
                        <th className="px-6 py-4">Time</th>
                        <th className="px-6 py-4 text-cyan-500">Down</th>
                        <th className="px-6 py-4 text-green-500">Up</th>
                        <th className="px-6 py-4 text-yellow-500">Ping</th>
                        <th className="px-6 py-4">WiFi / Signal</th>
                        <th className="px-6 py-4">ISP / Region</th>
                        <th className="px-6 py-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {tests.slice(0, 15).map((t, idx) => {
                        const ispTests = tests.filter(test => test.isp === t.isp);
                        const ispAvg = ispTests.reduce((a, b) => a + b.downloadSpeed, 0) / (ispTests.length || 1);
                        const isThrottle = t.downloadSpeed < (ispAvg * 0.5);
                        const isDrop = t.downloadSpeed < (ispAvg * 0.7);

                        return (
                          <tr key={idx} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-6 py-4 text-sm text-white/60">{format(t.timestamp, 'HH:mm:ss')}</td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className={cn(
                                  "font-bold text-lg", 
                                  isThrottle ? "text-red-500" : isDrop ? "text-yellow-500" : "text-white"
                                )}>
                                  {formatMbps(t.downloadSpeed)}
                                </span>
                                <span className="text-[8px] opacity-30 uppercase font-black tracking-tighter">Mbps</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm opacity-80">{formatMbps(t.uploadSpeed)}</td>
                            <td className="px-6 py-4 text-sm opacity-80">{formatMs(t.ping)}ms</td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-xs font-bold text-white/90 truncate max-w-[120px]">{t.wifiName}</span>
                                <div className="flex items-center gap-1.5">
                                  <div className="flex items-end gap-0.5 h-3">
                                    {[1, 2, 3, 4].map((bar) => {
                                      const isActive = (t.signalStrength || 0) >= (bar * 25 - 15);
                                      const strengthColor = 
                                        (t.signalStrength || 0) >= 80 ? "bg-green-400" :
                                        (t.signalStrength || 0) >= 60 ? "bg-cyan-400" :
                                        (t.signalStrength || 0) >= 40 ? "bg-yellow-400" : "bg-red-400";
                                      
                                      return (
                                        <div 
                                          key={bar} 
                                          className={cn(
                                            "w-1 rounded-full transition-all duration-300",
                                            bar === 1 && "h-1.5",
                                            bar === 2 && "h-2",
                                            bar === 3 && "h-2.5",
                                            bar === 4 && "h-3",
                                            isActive ? strengthColor : "bg-white/5"
                                          )} 
                                        />
                                      );
                                    })}
                                  </div>
                                  <span className={cn(
                                    "text-[9px] uppercase font-black tracking-widest",
                                    (t.signalStrength || 0) >= 80 ? "text-green-400" :
                                    (t.signalStrength || 0) >= 60 ? "text-cyan-400" :
                                    (t.signalStrength || 0) >= 40 ? "text-yellow-400" : "text-red-400"
                                  )}>
                                    {t.signalStrength}%
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 mt-1 opacity-50">
                                  <div className="flex items-center gap-1">
                                    <Radio size={8} />
                                    <span className="text-[8px] font-bold tracking-tight">{t.distance}m</span>
                                  </div>
                                  {t.location?.city && (
                                    <div className="flex items-center gap-1 border-l border-white/10 pl-2">
                                      <MapPin size={8} className="text-cyan-400" />
                                      <span className="text-[8px] font-bold uppercase truncate max-w-[70px]">{t.location.city}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                               <div className="flex flex-col">
                                 <span className="text-xs font-bold truncate max-w-[100px]">{t.isp}</span>
                                 <span className="text-[9px] opacity-30 font-bold uppercase tracking-tighter">Sri Lanka</span>
                               </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "text-[9px] uppercase font-bold tracking-widest px-2 py-1 rounded-md",
                                isThrottle 
                                  ? "bg-red-500/20 text-red-500 border border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]" 
                                  : isDrop
                                  ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/10"
                                  : (t.isManual ? "bg-cyan-500/10 text-cyan-500" : "bg-white/5 text-white/40")
                              )}>
                                {isThrottle ? "Throttle" : isDrop ? "Drop" : (t.isManual ? "Manual" : "Auto")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {tests.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-white/20 italic">
                            No logs yet. Run a test to begin.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'trends' && (
            <motion.div 
              key="trends"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              <div className="bg-[#151515] rounded-[32px] p-8 border border-white/5">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Speed Trends</h2>
                    <p className="text-white/40 text-sm">Download performance over time</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex items-center gap-2 text-xs text-white/40 bg-white/5 px-3 py-1 rounded-full">
                      <div className="w-2 h-2 rounded-full bg-cyan-500" /> Download (Mbps)
                    </span>
                  </div>
                </div>
                
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={[...tests].reverse()}>
                      <defs>
                        <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={(t) => format(t, 'HH:mm')} 
                        stroke="rgba(255,255,255,0.2)"
                        tick={{fontSize: 10}}
                      />
                      <YAxis stroke="rgba(255,255,255,0.2)" tick={{fontSize: 10}} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#151515', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        labelFormatter={(l) => format(new Date(l), 'MMM d, HH:mm')}
                      />
                      <Area type="monotone" dataKey="downloadSpeed" stroke="#06b6d4" strokeWidth={3} fillOpacity={1} fill="url(#colorDown)" />
                      <Area type="monotone" dataKey="uploadSpeed" stroke="#22c55e" strokeWidth={2} fillOpacity={0.1} fill="#22c55e" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[#151515] rounded-[32px] p-8 border border-white/5">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Latency Trends</h2>
                    <p className="text-white/40 text-sm">Ping (ms) over time</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="flex items-center gap-2 text-xs text-white/40 bg-white/5 px-3 py-1 rounded-full">
                      <div className="w-2 h-2 rounded-full bg-yellow-500" /> Ping (ms)
                    </span>
                  </div>
                </div>
                
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...tests].reverse()}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis 
                        dataKey="timestamp" 
                        tickFormatter={(t) => format(new Date(t), 'HH:mm')} 
                        stroke="rgba(255,255,255,0.2)"
                        tick={{fontSize: 10}}
                      />
                      <YAxis 
                        stroke="rgba(255,255,255,0.2)" 
                        tick={{fontSize: 10}} 
                        label={{ value: 'ms', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#151515', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        labelFormatter={(l) => format(new Date(l), 'MMM d, HH:mm')}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="ping" 
                        stroke="#eab308" 
                        strokeWidth={3} 
                        dot={{ r: 4, fill: '#eab308', strokeWidth: 0 }} 
                        activeDot={{ r: 6, strokeWidth: 0 }} 
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-[#151515] rounded-[32px] p-8 border border-white/5">
                <h3 className="text-xl font-bold mb-8">ISP Benchmark</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={Object.entries(
                        tests.reduce((acc, t) => {
                          if (!acc[t.isp]) acc[t.isp] = { sum: 0, count: 0 };
                          acc[t.isp].sum += t.downloadSpeed;
                          acc[t.isp].count += 1;
                          return acc;
                        }, {} as Record<string, { sum: number, count: number }>)
                      ).map(([isp, data]) => ({
                        isp,
                        avgSpeed: (data as { sum: number, count: number }).sum / (data as { sum: number, count: number }).count
                      }))}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                      <XAxis 
                        dataKey="isp" 
                        stroke="rgba(255,255,255,0.2)" 
                        tick={{fontSize: 10}}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="rgba(255,255,255,0.2)" 
                        tick={{fontSize: 10}}
                        axisLine={false}
                        label={{ value: 'Mbps', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                      />
                      <Tooltip 
                        cursor={{fill: 'rgba(255,255,255,0.05)'}}
                        contentStyle={{ backgroundColor: '#151515', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                        itemStyle={{ color: '#06b6d4' }}
                      />
                      <Bar 
                        dataKey="avgSpeed" 
                        radius={[6, 6, 0, 0]}
                        barSize={40}
                      >
                        {
                          Object.keys(tests.reduce((acc, t) => ({ ...acc, [t.isp]: true }), {})).map((_, index) => (
                            <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#06b6d4' : '#0891b2'} />
                          ))
                        }
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-[#151515] rounded-[32px] p-8 border border-white/5">
                  <h3 className="font-bold mb-4 opacity-50 uppercase text-xs tracking-widest">ISP Performance Variance</h3>
                    <div className="space-y-4">
                    {Object.entries(
                      tests.reduce((acc, t) => {
                        if (!acc[t.isp]) acc[t.isp] = [];
                        acc[t.isp].push(t.downloadSpeed);
                        return acc;
                      }, {} as Record<string, number[]>)
                    ).map(([isp, speeds]) => {
                      const avg = (speeds as number[]).reduce((a, b) => a + b) / (speeds as number[]).length;
                      const max = Math.max(...(speeds as number[]));
                      const min = Math.min(...(speeds as number[]));
                      const variance = ((max - min) / avg) * 100;

                      return (
                        <div key={isp} className="p-4 bg-white/5 rounded-2xl border border-white/5">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-sm">{isp}</span>
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full",
                              variance > 50 ? "bg-red-500/20 text-red-500" : "bg-green-500/20 text-green-500"
                            )}>
                              {variance.toFixed(0)}% Variance
                            </span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${(avg / 100) * 100}%` }} />
                          </div>
                          <div className="flex justify-between mt-2 text-[10px] uppercase text-white/30 font-bold">
                            <span>AVG {avg.toFixed(1)} Mbps</span>
                            <span>PEAK {max.toFixed(1)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-[#151515] rounded-[32px] p-8 border border-white/5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-5">
                    <BarChart3 size={100} />
                  </div>
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="font-bold opacity-50 uppercase text-xs tracking-widest">Pulse Intelligence</h3>
                    <div className="px-2 py-1 bg-cyan-500/10 text-cyan-500 rounded text-[10px] font-black uppercase tracking-tighter">AI Analyzed</div>
                  </div>
                  
                  <div className="space-y-4 relative z-10">
                    {analyzePerformance(tests).map((insight, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className={cn(
                          "p-4 rounded-2xl border flex items-start gap-4",
                          insight.type === 'success' && "bg-green-500/5 border-green-500/10",
                          insight.type === 'warning' && "bg-yellow-500/5 border-yellow-500/10",
                          insight.type === 'error' && "bg-red-500/5 border-red-500/10",
                          insight.type === 'info' && "bg-cyan-500/5 border-cyan-500/10"
                        )}
                      >
                        <div className={cn(
                          "mt-1 w-2 h-2 rounded-full shrink-0",
                          insight.type === 'success' && "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]",
                          insight.type === 'warning' && "bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]",
                          insight.type === 'error' && "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]",
                          insight.type === 'info' && "bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]"
                        )} />
                        <div>
                          <p className={cn(
                            "text-sm font-bold mb-0.5",
                            insight.type === 'success' && "text-green-400",
                            insight.type === 'warning' && "text-yellow-400",
                            insight.type === 'error' && "text-red-400",
                            insight.type === 'info' && "text-cyan-400"
                          )}>
                            {insight.title}
                          </p>
                          <p className="text-xs text-white/40 leading-relaxed">
                            {insight.description}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'optimizer' && (
            <motion.div 
              key="optimizer"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8 pb-32"
            >
              <div className="bg-[#151515] rounded-[32px] p-8 sm:p-12 border border-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                  {testConditions.connectionType === 'cellular' ? (
                    <Smartphone size={240} className={cn("transition-all duration-1000", isLiveMonitoring && "animate-pulse text-cyan-500")} />
                  ) : (
                    <Radio size={240} className={cn("transition-all duration-1000", isLiveMonitoring && "animate-pulse text-cyan-500")} />
                  )}
                </div>
                
                <div className="relative z-10 max-w-2xl">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-black uppercase tracking-widest mb-4">
                    <Zap size={12} className="animate-pulse" /> 
                    {testConditions.connectionType === 'cellular' ? `${testConditions.networkType} Performance Assistant` : 'Router Placement Assistant'}
                  </div>
                  <h2 className="text-4xl font-black tracking-tighter mb-4">
                    {testConditions.connectionType === 'cellular' ? 'Mobile Data Optimizer' : 'Signal Optimizer'}
                  </h2>
                  <p className="text-white/40 mb-10 text-lg leading-relaxed font-medium">
                    {testConditions.connectionType === 'cellular' 
                      ? `Move around your area to find the strongest ${testConditions.networkType} reception. We'll track your peak signal spots so you can find the best indoor coverage.`
                      : 'Move your router or workspace while monitoring the live score. We\'ll track your "Sweet Spot" automatically so you can find the absolute peak performance location in your home.'}
                  </p>
                  
                  <button 
                    onClick={() => setIsLiveMonitoring(!isLiveMonitoring)}
                    className={cn(
                      "group relative px-12 py-6 rounded-3xl font-black uppercase tracking-[0.2em] text-xs transition-all overflow-hidden shadow-2xl active:scale-95",
                      isLiveMonitoring 
                        ? "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20" 
                        : "bg-white text-black hover:bg-cyan-400 shadow-white/10"
                    )}
                  >
                    <span className="relative z-10 flex items-center gap-3">
                      {isLiveMonitoring ? <WifiOff size={18} /> : (testConditions.connectionType === 'cellular' ? <Smartphone size={18} /> : <Radio size={18} />)}
                      {isLiveMonitoring ? "End Live Session" : `Start Live ${testConditions.connectionType === 'cellular' ? 'Mobile' : 'Placement'} Feed`}
                    </span>
                  </button>
                </div>
              </div>

              {isLiveMonitoring && liveData && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Quality Orbit */}
                  <div className="lg:col-span-4 bg-[#151515] rounded-[32px] p-10 border border-white/5 flex flex-col items-center justify-center text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/5 to-transparent opacity-50" />
                    <div className="relative w-56 h-56 flex items-center justify-center mb-8">
                      {/* Pulsing rings */}
                      <motion.div 
                        animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.05, 0.1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute inset-0 border border-cyan-500 rounded-full"
                      />
                      <svg className="w-full h-full -rotate-90 relative z-10">
                        <circle cx="112" cy="112" r="100" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                        <motion.circle 
                          cx="112" cy="112" r="100" stroke="currentColor" strokeWidth="12" fill="transparent" 
                          strokeDasharray={628}
                          initial={{ strokeDashoffset: 628 }}
                          animate={{ strokeDashoffset: 628 - (628 * liveData.score / 100) }}
                          className={cn(
                            "transition-all duration-1000 stroke-cap-round",
                            liveData.score > 85 ? "text-green-400" : liveData.score > 65 ? "text-cyan-400" : liveData.score > 40 ? "text-yellow-400" : "text-red-400"
                          )}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
                        <span className="text-6xl font-black tracking-tighter">{liveData.score.toFixed(0)}</span>
                        <span className="text-[10px] uppercase font-black tracking-[0.3em] text-white/30">Score</span>
                      </div>
                    </div>
                    
                    <div className="space-y-4 relative z-10 w-full">
                      <div className={cn(
                        "px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border backdrop-blur-xl",
                        liveData.score > 85 ? "bg-green-500/10 border-green-500/30 text-green-400" : 
                        liveData.score > 65 ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" : 
                        liveData.score > 40 ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" : 
                        "bg-red-500/10 border-red-500/30 text-red-400 animate-pulse"
                      )}>
                        {liveData.score > 85 ? "Optimal Placement" : 
                         liveData.score > 65 ? "Strong Connection" : 
                         liveData.score > 40 ? "Fair Stability" : "Severe Obstruction"}
                      </div>

                      {/* Sweet Spot Marker */}
                      {peakScore && (
                        <div className="bg-cyan-500/10 rounded-2xl p-4 border border-cyan-500/20 relative group">
                          <div className="absolute -top-2 -right-2">
                            <span className="flex h-4 w-4">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-4 w-4 bg-cyan-500"></span>
                            </span>
                          </div>
                          <p className="text-[9px] uppercase font-black text-cyan-400 tracking-[0.2em] mb-1">Sweet Spot Detected</p>
                          <div className="flex items-baseline justify-between">
                            <p className="text-2xl font-black font-mono text-white">
                              {peakScore.score.toFixed(0)}
                              <span className="text-[10px] ml-1 opacity-40 uppercase font-black tracking-tighter">Peak Health</span>
                            </p>
                            <p className="text-[10px] font-bold text-white/40">{format(peakScore.timestamp, 'HH:mm:ss')}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Metrics & Graph */}
                  <div className="lg:col-span-8 space-y-8">
                    {/* Live Guidance Banner */}
                    <div className={cn(
                      "p-6 rounded-[32px] border flex flex-col sm:flex-row items-center gap-6 transition-all duration-500",
                      liveData.score > 85 ? "bg-cyan-500/10 border-cyan-500/20" : 
                      liveData.score > 60 ? "bg-yellow-500/10 border-yellow-500/20" : 
                      "bg-red-500/10 border-red-500/20"
                    )}>
                      <div className={cn(
                        "p-4 rounded-2xl",
                        liveData.score > 85 ? "bg-cyan-500/20" : liveData.score > 60 ? "bg-yellow-500/20" : "bg-red-500/20"
                      )}>
                        {liveData.score > 85 ? <CheckCircle className="text-cyan-400" /> : <Info className={liveData.score > 60 ? "text-yellow-400" : "text-red-400"} />}
                      </div>
                      <div className="flex-1 text-center sm:text-left">
                        <h4 className={cn(
                          "text-sm font-black uppercase tracking-widest mb-1",
                          liveData.score > 85 ? "text-cyan-400" : liveData.score > 60 ? "text-yellow-400" : "text-red-400"
                        )}>
                          {liveData.score > 85 ? "Optimal Position" : 
                           liveData.score > 60 ? (testConditions.connectionType === 'cellular' ? "Signal Weakening: Try Windows" : "Sub-Optimal: Move Closer") : 
                           (testConditions.connectionType === 'cellular' ? "Low Coverage: Try Higher Ground" : "Action Required: High Obstruction")}
                        </h4>
                        <p className="text-xs text-white/50 leading-relaxed font-medium">
                          {liveData.score > 85 ? (testConditions.connectionType === 'cellular' ? `Excellent ${testConditions.networkType} saturation. You are in a high-reception zone for your carrier.` : "This spot maximizes your ISP potential. Minimal interference and maximum data saturation achieved.") : 
                           liveData.score > 60 ? (testConditions.connectionType === 'cellular' ? "Reception is oscillating. Cellular waves often struggle with building density; try moving closer to a window or an exterior wall." : "Signal density is dropping. Consider removing physical barriers or moving closer to the central hub for stability.") : 
                           (testConditions.connectionType === 'cellular' ? "Deep building penetration detected. Mobile data signals (especially 5G) are blocked by concrete. Moving near a large opening or upper floor is recommended." : "Severe throughput drop. The current path is likely traversing thick walls or high-noise zones. Relocate 3-5 meters closer.")}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="bg-[#151515] p-8 rounded-[32px] border border-white/5 relative group">
                        <div className="absolute top-4 right-4 text-cyan-500/20 group-hover:text-cyan-500/40 transition-colors">
                          <Zap size={24} />
                        </div>
                        <p className="text-[10px] uppercase font-black text-white/30 tracking-[0.2em] mb-2">Throughput</p>
                        <p className="text-4xl font-black tracking-tighter">{liveData.instantMbps.toFixed(1)}</p>
                        <p className="text-[10px] font-bold text-white/20 mt-1 uppercase">Mbps Live</p>
                      </div>

                      <div className="bg-[#151515] p-8 rounded-[32px] border border-white/5 relative group">
                        <div className="absolute top-4 right-4 text-yellow-500/20 group-hover:text-yellow-500/40 transition-colors">
                          <Clock size={24} />
                        </div>
                        <p className="text-[10px] uppercase font-black text-white/30 tracking-[0.2em] mb-2">Stability</p>
                        <p className="text-4xl font-black tracking-tighter">{liveData.ping.toFixed(0)}</p>
                        <p className="text-[10px] font-bold text-white/20 mt-1 uppercase">Latency ms</p>
                      </div>

                      <div className="bg-[#151515] p-8 rounded-[32px] border border-white/5 relative group">
                        <div className="absolute top-4 right-4 text-purple-500/20 group-hover:text-purple-500/40 transition-colors">
                          <Activity size={24} />
                        </div>
                        <p className="text-[10px] uppercase font-black text-white/30 tracking-[0.2em] mb-2">Jitter</p>
                        <p className="text-4xl font-black tracking-tighter">{liveData.jitter.toFixed(1)}</p>
                        <p className="text-[10px] font-bold text-white/20 mt-1 uppercase">Variance ms</p>
                      </div>
                    </div>

                    <div className="bg-[#151515] p-10 rounded-[40px] border border-white/5 h-[400px] relative overflow-hidden group">
                      <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:40px_40px]" />
                      <div className="relative z-10 flex flex-col h-full">
                        <div className="flex items-center justify-between mb-10">
                          <div>
                            <h3 className="text-sm font-black uppercase tracking-[0.2em]">Spectrum Path Trace</h3>
                            <p className="text-[10px] text-white/30 font-bold">Historical data for the last 60 seconds</p>
                          </div>
                          <div className="flex gap-6">
                            <span className="flex items-center gap-2 text-[10px] font-black text-cyan-500 uppercase tracking-widest">
                              <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" /> Health
                            </span>
                            <span className="flex items-center gap-2 text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                              <div className="w-2 h-2 rounded-full bg-yellow-500" /> Latency
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex-1 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={liveHistory}>
                              <defs>
                                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#151515', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
                                labelStyle={{ display: 'none' }}
                                itemStyle={{ fontWeight: '900', textTransform: 'uppercase', fontSize: '10px' }}
                              />
                              <Area 
                                type="monotone" 
                                dataKey="score" 
                                stroke="#06b6d4" 
                                fillOpacity={1} 
                                fill="url(#colorScore)" 
                                strokeWidth={4} 
                                isAnimationActive={false} 
                              />
                              <Area 
                                type="monotone" 
                                dataKey="ping" 
                                stroke="#eab308" 
                                fill="transparent" 
                                strokeWidth={2} 
                                strokeDasharray="8 8" 
                                isAnimationActive={false} 
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="bg-[#151515] rounded-[32px] p-10 border border-white/5 shadow-2xl">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-cyan-500">
                    <Settings size={28} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight">Auto-Pulse Config</h2>
                    <p className="text-white/40">Manage your automated tracking intervals</p>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="space-y-4">
                    <label className="text-xs font-bold uppercase tracking-widest text-white/50 block">Testing Interval</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[0, 1, 2, 4, 8, 12, 24].map((h) => (
                        <button
                          key={h}
                          onClick={() => {
                            const newCfg = { ...config, testInterval: h };
                            setConfig(newCfg);
                            speedTestService.saveUserConfig(newCfg);
                          }}
                          className={cn(
                            "py-4 rounded-2xl border transition-all text-sm font-bold flex flex-col items-center gap-1",
                            config.testInterval === h 
                              ? "bg-cyan-500 border-cyan-400 text-black" 
                              : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                          )}
                        >
                          <span className="text-lg">{h === 0 ? "Off" : h}</span>
                          <span className="text-[10px] uppercase">{h === 0 ? "Manual Only" : "Hours"}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Advanced Settings section */}
                  <div className="pt-8 border-t border-white/5 space-y-8">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-white/50">Measurement Precision</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <label className="text-xs font-bold text-white/30 uppercase tracking-widest">Parallel Connections</label>
                        <div className="flex items-center gap-4">
                          <input 
                            type="range" min="1" max="16" 
                            value={config.parallelConnections || 4} 
                            onChange={(e) => {
                              const v = parseInt(e.target.value);
                              const newCfg = { ...config, parallelConnections: v };
                              setConfig(newCfg);
                              speedTestService.saveUserConfig(newCfg);
                            }}
                            className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-500"
                          />
                          <span className="text-lg font-black font-mono w-8">{config.parallelConnections || 4}</span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <label className="text-xs font-bold text-white/30 uppercase tracking-widest">Test Duration (sec)</label>
                        <div className="flex items-center gap-4">
                          <input 
                            type="range" min="5" max="30" 
                            value={config.testDuration || 5} 
                            onChange={(e) => {
                              const v = parseInt(e.target.value);
                              const newCfg = { ...config, testDuration: v };
                              setConfig(newCfg);
                              speedTestService.saveUserConfig(newCfg);
                            }}
                            className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-500"
                          />
                          <span className="text-lg font-black font-mono w-8">{config.testDuration || 5}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <div 
                          onClick={() => {
                            const newCfg = { ...config, measureLoadedLatency: !config.measureLoadedLatency };
                            setConfig(newCfg);
                            speedTestService.saveUserConfig(newCfg);
                          }}
                          className={cn(
                            "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                            config.measureLoadedLatency !== false ? "bg-cyan-500 border-cyan-400" : "border-white/10 group-hover:border-white/20"
                          )}
                        >
                          {config.measureLoadedLatency !== false && <div className="w-2 h-2 rounded-full bg-black" />}
                        </div>
                        <span className="text-sm font-bold text-white/60">Measure loaded latency during testing</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-white/5">
                    <div className="flex items-start gap-4">
                      <div className="mt-1 w-5 h-5 rounded-full border-2 border-cyan-500 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-cyan-500" />
                      </div>
                      <div className="space-y-2">
                        <p className="font-semibold">Persistent Tracking Note</p>
                        <p className="text-sm text-gray-500 leading-relaxed">
                          Automated tests run in the background while this tab is open. Due to browser limitations, tests cannot run if the tab is completely suspended or closed.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavIcon({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 group relative transition-all",
        active ? "text-cyan-500" : "text-white/40 hover:text-white"
      )}
    >
      <div className={cn(
        "p-2 rounded-xl transition-all",
        active ? "bg-cyan-500/10 shadow-[0_0_15px_rgba(6,182,212,0.2)]" : "group-hover:bg-white/5"
      )}>
        {icon}
      </div>
      <span className="text-[10px] uppercase font-bold tracking-widest">{label}</span>
      {active && (
        <motion.div 
          layoutId="activeTab"
          className="absolute -bottom-4 left-0 right-0 h-1 bg-cyan-500 rounded-full"
        />
      )}
    </button>
  );
}

function MiniStatCard({ icon, label, value, unit }: { icon: React.ReactNode, label: string, value: string, unit: string }) {
  return (
    <div className="bg-[#151515] rounded-3xl p-6 border border-white/5 flex items-center justify-between group hover:border-white/10 transition-all">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-white/10 transition-all">
          {icon}
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-white/30">{label}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black">{value}</span>
            <span className="text-xs font-bold text-white/20 uppercase">{unit}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
