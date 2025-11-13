"use client";

import { useState, useEffect, useRef } from "react";

export default function BlowDetection() {
  const [blowCount, setBlowCount] = useState(0);
  const [isBlowActive, setIsBlowActive] = useState(false);
  const [blowPermissionStatus, setBlowPermissionStatus] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [blowErrorMessage, setBlowErrorMessage] = useState("");
  const [currentVolume, setCurrentVolume] = useState(0);

  const [serRatioThreshold, setSerRatioThreshold] = useState(2.2);
  const [blowDuration, setBlowDuration] = useState(100);
  const [blowCooldown, setBlowCooldown] = useState(500);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [useSuppression, setUseSuppression] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [isLogging, setIsLogging] = useState(true);
  const [historyCount, setHistoryCount] = useState(0);

  const [debugValues, setDebugValues] = useState({
    E_low: 0,
    E_mid: 0,
    ratio: 0,
    centroid: 0,
    candidate: false,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null); // Nguồn từ mic
  const rafIdRef = useRef<number | null>(null);

  const fileAudioBufferRef = useRef<AudioBuffer | null>(null); // Buffer âm thanh
  const fileSourceNodeRef = useRef<AudioBufferSourceNode | null>(null); // Nguồn từ file
  const [fileName, setFileName] = useState("");

  const debugHistoryRef = useRef<string[]>([]);
  const startTimeRef = useRef<number | null>(null);

  const lastBlowTimeRef = useRef(0);
  const blowStartTimeRef = useRef(0);
  const isCurrentlyBlowingRef = useRef(false);
  const hasCountedThisBlowRef = useRef(false);

  const baselineLowRef = useRef(0);
  const baselineLowStdRef = useRef(0);
  const baselineMidRef = useRef(0);
  const baselineMidStdRef = useRef(0);
  const calibEndTimeRef = useRef<number | null>(null);
  const calibSumLowRef = useRef(0);
  const calibSumLowSqRef = useRef(0);
  const calibSumMidRef = useRef(0);
  const calibSumMidSqRef = useRef(0);
  const calibCountRef = useRef(0);

  // Refs cho logic đếm
  const frameCountRef = useRef(0);
  const missedFramesRef = useRef(0);
  const MAX_MISSED_FRAMES = 2; // "Grace period"

  // Helper lấy AudioContext
  const getAudioContext = () => {
    if (
      !audioContextRef.current ||
      audioContextRef.current.state === "closed"
    ) {
      audioContextRef.current = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  // === SỬA HÀM getBands ĐỂ TRẢ VỀ hzPerBin ===
  const getBands = (
    dataArray: Uint8Array,
    bufferLength: number,
    sampleRate: number
  ) => {
    const hzPerBin = sampleRate / 2 / bufferLength;
    const toBin = (hz: number) =>
      Math.max(0, Math.min(bufferLength, Math.floor(hz / hzPerBin)));
    const lowStartBin = 0;
    const lowEndBin = Math.max(1, toBin(300));
    const midStartBin = Math.max(0, toBin(300));
    const midEndBin = Math.max(midStartBin + 1, toBin(3000));

    let low = 0;
    for (let i = lowStartBin; i < lowEndBin; i++) low += dataArray[i];
    const lowBins = Math.max(lowEndBin - lowStartBin, 1);
    const E_low = low / lowBins;

    let mid = 0;
    for (let i = midStartBin; i < midEndBin; i++) mid += dataArray[i];
    const midBins = Math.max(midEndBin - midStartBin, 1);
    const E_mid = mid / midBins;

    return {
      E_low,
      E_mid,
      hzPerBin, // Trả về để dùng cho centroid
    };
  };

  // Download log (đã thêm centroid)
  const downloadDebugHistory = () => {
    if (!debugHistoryRef.current.length) return;
    const header = "time_ms,E_low,E_mid,SER,centroid_Hz,candidate"; // Thêm centroid_Hz
    const content = [header, ...debugHistoryRef.current].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `blow_debug_${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearDebugHistory = () => {
    debugHistoryRef.current = [];
    setHistoryCount(0);
  };

  // === THÊM LẠI HÀM computeCentroid ===
  const computeCentroid = (
    dataArray: Uint8Array,
    bufferLength: number,
    hzPerBin: number
  ) => {
    let num = 0;
    let den = 0.000001; // Tránh chia cho 0
    for (let i = 0; i < bufferLength; i++) {
      const p = dataArray[i]; // power
      num += p * (i * hzPerBin); // power * frequency
      den += p; // total power
    }
    return num / den; // weighted average
  };

  // === HÀM QUYẾT ĐỊNH (3 ĐIỀU KIỆN) ===
  const decideCandidate = (features: {
    E_low: number;
    ratio: number;
    centroid: number;
  }) => {
    if (isCalibrating) return false;

    // ĐK 1: Năng lượng (Ngưỡng 120)
    const energyOk =
      features.E_low >
      Math.max(120, baselineLowRef.current + 3 * baselineLowStdRef.current);

    // ĐK 2: Tỷ lệ SER (Ngưỡng do người dùng chọn)
    const ratioOk = features.ratio > serRatioThreshold;

    // ĐK 3: Trọng tâm phổ (Ngưỡng 1000Hz)
    const centroidOk = features.centroid < 1500;

    return energyOk && ratioOk && centroidOk; // Phải thỏa mãn CẢ BA
  };

  // === HÀM PROCESSFRAME (ĐÃ CẬP NHẬT) ===
  const processFrame = () => {
    if (!analyserRef.current || !audioContextRef.current) return;
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const sampleRate = audioContextRef.current.sampleRate;

    // Tính toán các chỉ số
    const { E_low, E_mid, hzPerBin } = getBands(
      dataArray,
      bufferLength,
      sampleRate
    );
    const centroid = computeCentroid(dataArray, bufferLength, hzPerBin);
    const ratio = E_low / (E_mid + 0.01);

    if (showDebug) {
      console.log(
        `E_low: ${E_low.toFixed(0)}, E_mid: ${E_mid.toFixed(
          0
        )}, Ratio: ${ratio.toFixed(1)}, Centroid: ${centroid.toFixed(0)}`
      );
    }

    setCurrentVolume(Math.round(E_low));
    const now = Date.now();

    if (isCalibrating) {
      // Logic calibration (giữ nguyên)
      calibSumLowRef.current += E_low;
      calibSumLowSqRef.current += E_low * E_low;
      calibSumMidRef.current += E_mid;
      calibSumMidSqRef.current += E_mid * E_mid;
      calibCountRef.current += 1;
      if (calibEndTimeRef.current && now >= calibEndTimeRef.current) {
        const n = Math.max(calibCountRef.current, 1);
        const mLow = calibSumLowRef.current / n;
        const vLow = Math.max(calibSumLowSqRef.current / n - mLow * mLow, 0);
        const mMid = calibSumMidRef.current / n;
        const vMid = Math.max(calibSumMidSqRef.current / n - mMid * mMid, 0);
        baselineLowRef.current = mLow;
        baselineLowStdRef.current = Math.sqrt(vLow);
        baselineMidRef.current = mMid;
        baselineMidStdRef.current = Math.sqrt(vMid);
        setIsCalibrating(false);
        calibEndTimeRef.current = null;
      }
    } else {
      // Truyền centroid vào hàm quyết định
      const candidate = decideCandidate({ E_low, ratio, centroid });

      // Logic đếm với grace period (giữ nguyên)
      if (candidate) {
        missedFramesRef.current = 0;
        if (!isCurrentlyBlowingRef.current) {
          isCurrentlyBlowingRef.current = true;
          hasCountedThisBlowRef.current = false;
          blowStartTimeRef.current = now;
        } else {
          const blowingDuration = now - blowStartTimeRef.current;
          if (
            blowingDuration >= blowDuration &&
            now - lastBlowTimeRef.current > blowCooldown &&
            !hasCountedThisBlowRef.current
          ) {
            lastBlowTimeRef.current = now;
            hasCountedThisBlowRef.current = true;
            setBlowCount((p) => p + 1);
            if (navigator.vibrate) navigator.vibrate(100);
          }
        }
      } else {
        if (isCurrentlyBlowingRef.current) {
          missedFramesRef.current += 1;
          if (missedFramesRef.current > MAX_MISSED_FRAMES) {
            isCurrentlyBlowingRef.current = false;
            blowStartTimeRef.current = 0;
            hasCountedThisBlowRef.current = false;
          }
        }
      }

      // Cập nhật UI debug
      if (frameCountRef.current % 6 === 0) {
        setDebugValues({
          E_low: Math.round(E_low),
          E_mid: Math.round(E_mid),
          ratio: Math.round(ratio * 10) / 10,
          centroid: Math.round(centroid),
          candidate,
        });

        // Ghi log
        if (isLogging && !isCalibrating) {
          const elapsed = startTimeRef.current
            ? Date.now() - startTimeRef.current
            : 0;
          const line = [
            String(elapsed),
            String(Math.round(E_low)),
            String(Math.round(E_mid)),
            ratio.toFixed(2),
            String(Math.round(centroid)),
            candidate ? "1" : "0",
          ].join(",");
          debugHistoryRef.current.push(line);
          setHistoryCount(debugHistoryRef.current.length);
        }
      }
    }

    frameCountRef.current++;
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(processFrame);
  };

  // (Các hàm requestMicrophoneAndStart, handleFileChange, processFileAndStart
  //  không thay đổi so với phiên bản trước)

  const requestMicrophoneAndStart = async () => {
    setBlowErrorMessage("");
    try {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: useSuppression,
            noiseSuppression: useSuppression,
            autoGainControl: useSuppression,
          } as MediaTrackConstraints,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      if (!stream) throw new Error("No media stream");
      micStreamRef.current = stream; // Lưu nguồn mic

      const audioContext = getAudioContext(); // Lấy context
      await audioContext.resume();

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser); // Nối mic -> analyser

      setBlowPermissionStatus("granted");
      setIsBlowActive(true);
      startTimeRef.current = Date.now();
      debugHistoryRef.current = [];
      setHistoryCount(0);
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(processFrame);
      calibrateEnvironment(1200);
    } catch (err) {
      setBlowErrorMessage(
        "Microphone access denied: " + (err as Error).message
      );
      setBlowPermissionStatus("denied");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName("Đang tải...");
    fileAudioBufferRef.current = null;
    setBlowErrorMessage("");

    const reader = new FileReader();
    reader.onload = async (readEvent) => {
      const arrayBuffer = readEvent.target?.result as ArrayBuffer;
      if (!arrayBuffer) return;

      const audioContext = getAudioContext();
      await audioContext.resume();

      try {
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        fileAudioBufferRef.current = buffer;
        setFileName(file.name);
      } catch (err) {
        setBlowErrorMessage("Lỗi giải mã file audio.");
        setFileName("");
      }
    };
    reader.onerror = () => {
      setBlowErrorMessage("Lỗi đọc file.");
      setFileName("");
    };
    reader.readAsArrayBuffer(file);
  };

  const processFileAndStart = async () => {
    if (!fileAudioBufferRef.current) {
      setBlowErrorMessage("Chưa có file audio nào được tải.");
      return;
    }

    const audioContext = getAudioContext();
    await audioContext.resume();

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3; // Phải giống hệt cài đặt live
    analyserRef.current = analyser;

    // Tạo nguồn từ buffer file
    const source = audioContext.createBufferSource();
    source.buffer = fileAudioBufferRef.current;
    fileSourceNodeRef.current = source; // Lưu ref để stop

    // Nối file -> analyser -> loa (để bạn nghe)
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    setIsBlowActive(true);
    startTimeRef.current = Date.now();
    debugHistoryRef.current = [];
    setHistoryCount(0);

    // Bắt đầu vòng lặp và phát file
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(processFrame);
    source.start();

    // Tự động dừng khi file phát xong
    source.onended = () => {
      stopDetection();
    };

    // Chạy calibration (giả định file có 1.2s im lặng ở đầu)
    calibrateEnvironment(1200);
  };

  // Hàm stop chung
  const stopDetection = () => {
    setIsBlowActive(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Dừng nguồn mic (nếu có)
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    // Dừng nguồn file (nếu có)
    if (fileSourceNodeRef.current) {
      fileSourceNodeRef.current.onended = null; // Hủy onended để tránh gọi lại
      try {
        fileSourceNodeRef.current.stop();
      } catch (e) {
        // Bỏ qua lỗi nếu đã stop
      }
      fileSourceNodeRef.current = null;
    }

    // Đóng context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Reset logic đếm
    isCurrentlyBlowingRef.current = false;
    hasCountedThisBlowRef.current = false;
    blowStartTimeRef.current = 0;
    lastBlowTimeRef.current = 0;
    setCurrentVolume(0);
  };

  const resetBlowCounter = () => {
    setBlowCount(0);
    lastBlowTimeRef.current = 0;
    blowStartTimeRef.current = 0;
    isCurrentlyBlowingRef.current = false;
    hasCountedThisBlowRef.current = false;
  };

  const calibrateEnvironment = (ms = 1500) => {
    if (!isBlowActive || !analyserRef.current) return;
    setIsCalibrating(true);
    calibEndTimeRef.current = Date.now() + ms;
    calibSumLowRef.current = 0;
    calibSumLowSqRef.current = 0;
    calibSumMidRef.current = 0;
    calibSumMidSqRef.current = 0;
    calibCountRef.current = 0;
  };

  useEffect(() => {
    // Cleanup khi component unmount
    return () => {
      stopDetection();
    };
  }, []);

  // --- BẮT ĐẦU JSX (ĐÃ CẬP NHẬT DEBUG UI) ---
  return (
    <>
      {/* Blow Counter Display */}
      <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl p-8 text-center shadow-lg">
        <p className="text-white text-sm font-medium mb-2">Blow Count</p>
        <p className="text-7xl font-bold text-white mb-2">{blowCount}</p>
        <p className="text-white text-xs opacity-80">
          {isBlowActive ? "🌬️ Detecting..." : "⏸️ Detection paused"}
        </p>
      </div>

      {isBlowActive && (
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">
              Current Volume (E_low)
            </span>
            <span className="text-sm font-bold text-blue-600">
              {currentVolume}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full transition-all duration-100"
              style={{
                width: `${Math.min((currentVolume / 255) * 100, 100)}%`,
              }}
            ></div>
          </div>
          <p className="text-xs text-gray-500 mt-1 text-center">
            SER &gt; {serRatioThreshold.toFixed(1)}x
          </p>
        </div>
      )}

      {showDebug && (
        <div className="bg-white border rounded-xl p-4 text-xs text-gray-700 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Calibrating</span>
            <span
              className={isCalibrating ? "text-amber-600" : "text-gray-500"}
            >
              {isCalibrating ? "running..." : "idle"}
            </span>
          </div>
          {/* Cập nhật JSX debug để hiển thị centroid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div>
              E_low: <span className="font-semibold">{debugValues.E_low}</span>
            </div>
            <div>
              E_mid: <span className="font-semibold">{debugValues.E_mid}</span>
            </div>
            <div>
              Ratio: <span className="font-semibold">{debugValues.ratio}x</span>
            </div>
            <div>
              Centroid:{" "}
              <span className="font-semibold">{debugValues.centroid} Hz</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span>Candidate</span>
            <span
              className={
                debugValues.candidate
                  ? "text-green-600 font-semibold"
                  : "text-gray-500"
              }
            >
              {debugValues.candidate ? "YES" : "no"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
            <div className="text-xs text-gray-600">
              Samples: <span className="font-semibold">{historyCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={isLogging}
                  onChange={(e) => setIsLogging(e.target.checked)}
                />
                Record
              </label>
              <button
                onClick={downloadDebugHistory}
                disabled={!historyCount}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                ⬇️ Download .txt
              </button>
              <button
                onClick={clearDebugHistory}
                disabled={!historyCount}
                className="px-2 py-1 border rounded disabled:opacity-50"
              >
                🧹 Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === SECTION TẢI FILE === */}
      <div className="space-y-3 bg-gray-50 border rounded-xl p-4">
        <p className="text-sm font-medium text-gray-800">
          Debug Bằng File Audio
        </p>
        <input
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          disabled={isBlowActive}
          className="text-sm w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {fileName && (
          <p className="text-xs text-gray-600 truncate">
            Tệp đã tải: <span className="font-medium">{fileName}</span>
          </p>
        )}
        <button
          onClick={processFileAndStart}
          disabled={!fileAudioBufferRef.current || isBlowActive}
          className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold py-3 px-6 rounded-xl shadow disabled:opacity-50"
        >
          ▶️ Process File
        </button>
      </div>
      {/* ============================= */}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={useSuppression}
              onChange={(e) => setUseSuppression(e.target.checked)}
              disabled={isBlowActive}
            />
            Mic suppression (EC/NS/AGC)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
            />
            Show debug
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium text-gray-700">
            SER Ratio Threshold
          </label>
          <span className="text-sm font-bold text-blue-600">
            {serRatioThreshold.toFixed(1)}x
          </span>
        </div>
        <input
          type="range"
          min="2"
          max="10"
          step="0.5"
          value={serRatioThreshold}
          onChange={(e) => setSerRatioThreshold(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          disabled={isBlowActive}
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Easy (2x)</span>
          <span>Strict (10x)</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium text-gray-700">
            Minimum Blow Duration
          </label>
          <span className="text-sm font-bold text-blue-600">
            {blowDuration}ms
          </span>
        </div>
        <input
          type="range"
          min="100"
          max="1000"
          step="50"
          value={blowDuration}
          onChange={(e) => setBlowDuration(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          disabled={isBlowActive}
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Short (100ms)</span>
          <span>Long (1000ms)</span>
        </div>
        <p className="text-xs text-gray-600 text-center">
          Must blow continuously for this duration
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium text-gray-700">
            Blow Cooldown
          </label>
          <span className="text-sm font-bold text-blue-600">
            {blowCooldown}ms
          </span>
        </div>
        <input
          type="range"
          min="100"
          max="2000"
          step="50"
          value={blowCooldown}
          onChange={(e) => setBlowCooldown(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
          disabled={isBlowActive}
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Fast (100ms)</span>
          <span>Slow (2000ms)</span>
        </div>
      </div>

      <div className="space-y-3">
        {!isBlowActive ? (
          <button
            onClick={requestMicrophoneAndStart}
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
          >
            🎤 Start Detection (Live)
          </button>
        ) : (
          <button
            onClick={stopDetection} // Đã đổi tên hàm
            className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
          >
            ⏸️ Stop Detection
          </button>
        )}

        <button
          onClick={() => calibrateEnvironment(1500)}
          disabled={!isBlowActive || isCalibrating}
          className="w-full bg-white border-2 border-amber-600 text-amber-700 font-bold py-3 px-6 rounded-xl hover:bg-amber-50 transition-all duration-200 disabled:opacity-50"
        >
          🧭 Calibrate {isCalibrating ? "(running...)" : "(1.5s)"}
        </button>

        <button
          onClick={resetBlowCounter}
          className="w-full bg-white border-2 border-blue-600 text-blue-600 font-bold py-3 px-6 rounded-xl hover:bg-blue-50 transition-all duration-200"
        >
          🔄 Reset Counter
        </button>
      </div>

      {blowErrorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">{blowErrorMessage}</p>
        </div>
      )}

      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Permission:</span>
          <span
            className={`font-medium ${
              blowPermissionStatus === "granted"
                ? "text-green-600"
                : blowPermissionStatus === "denied"
                ? "text-red-600"
                : "text-gray-600"
            }`}
          >
            {blowPermissionStatus === "granted"
              ? "✅ Granted"
              : blowPermissionStatus === "denied"
              ? "❌ Denied"
              : "⏳ Not requested"}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Status:</span>
          <span
            className={`font-medium ${
              isBlowActive ? "text-green-600" : "text-gray-600"
            }`}
          >
            {isBlowActive ? "🟢 Active" : "⚪ Inactive"}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Min Duration:</span>
          <span className="font-medium text-gray-800">{blowDuration}ms</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Cooldown:</span>
          <span className="font-medium text-gray-800">{blowCooldown}ms</span>
        </div>
      </div>
    </>
  );
}
