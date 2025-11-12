"use client";

import { useState, useEffect, useRef } from "react";

type TabType = "shake" | "blow";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("shake");

  // Shake states
  const [shakeCount, setShakeCount] = useState(0);
  const [sensitivity, setSensitivity] = useState(30);
  const [cooldown, setCooldown] = useState(500);
  const [isActive, setIsActive] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [errorMessage, setErrorMessage] = useState("");

  // Blow states
  const [blowCount, setBlowCount] = useState(0);
  const [blowThreshold, setBlowThreshold] = useState(100);
  const [blowDuration, setBlowDuration] = useState(500);
  const [blowCooldown, setBlowCooldown] = useState(1000);
  const [isBlowActive, setIsBlowActive] = useState(false);
  const [blowPermissionStatus, setBlowPermissionStatus] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [blowErrorMessage, setBlowErrorMessage] = useState("");
  const [currentVolume, setCurrentVolume] = useState(0);

  // Refs for shake tracking
  const lastX = useRef(0);
  const lastY = useRef(0);
  const lastZ = useRef(0);
  const lastShakeTime = useRef(0);

  // Refs for blow tracking
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastBlowTime = useRef(0);
  const blowStartTime = useRef(0);
  const isCurrentlyBlowing = useRef(false);

  const handleDeviceMotion = (event: DeviceMotionEvent) => {
    if (!isActive) return;

    const acceleration = event.accelerationIncludingGravity;
    if (!acceleration) return;

    const { x, y, z } = acceleration;

    // Skip first reading to establish baseline
    if (lastX.current === 0 && lastY.current === 0 && lastZ.current === 0) {
      lastX.current = x || 0;
      lastY.current = y || 0;
      lastZ.current = z || 0;
      return;
    }

    // Calculate total change in acceleration
    const deltaX = Math.abs((x || 0) - lastX.current);
    const deltaY = Math.abs((y || 0) - lastY.current);
    const deltaZ = Math.abs((z || 0) - lastZ.current);
    const totalDelta = deltaX + deltaY + deltaZ;

    // Update last values
    lastX.current = x || 0;
    lastY.current = y || 0;
    lastZ.current = z || 0;

    // Check if shake detected and cooldown period has passed
    const currentTime = Date.now();
    if (
      totalDelta > sensitivity &&
      currentTime - lastShakeTime.current > cooldown
    ) {
      lastShakeTime.current = currentTime;
      setShakeCount((prev) => prev + 1);

      // Visual feedback - vibrate if available
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
    }
  };

  const requestPermissionAndStart = async () => {
    setErrorMessage("");

    try {
      // Check if DeviceMotionEvent requires permission (iOS 13+)
      if (typeof (DeviceMotionEvent as any).requestPermission === "function") {
        const permission = await (DeviceMotionEvent as any).requestPermission();

        if (permission === "granted") {
          setPermissionStatus("granted");
          setIsActive(true);
        } else {
          setPermissionStatus("denied");
          setErrorMessage(
            "Permission denied. Please allow motion access in your browser settings."
          );
        }
      } else {
        // For browsers that don't require permission
        setPermissionStatus("granted");
        setIsActive(true);
      }
    } catch (error) {
      setErrorMessage(
        "Error requesting permission: " + (error as Error).message
      );
      setPermissionStatus("denied");
    }
  };

  const stopDetection = () => {
    setIsActive(false);
  };

  const resetCounter = () => {
    setShakeCount(0);
    lastShakeTime.current = 0;
  };

  // Blow detection functions
  const analyzeAudio = () => {
    if (!analyserRef.current || !isBlowActive) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    setCurrentVolume(Math.round(average));

    const currentTime = Date.now();

    // Check if volume exceeds threshold
    if (average > blowThreshold) {
      if (!isCurrentlyBlowing.current) {
        // Start of blow
        isCurrentlyBlowing.current = true;
        blowStartTime.current = currentTime;
      } else {
        // Continue blowing - check duration
        const blowTime = currentTime - blowStartTime.current;
        if (
          blowTime >= blowDuration &&
          currentTime - lastBlowTime.current > blowCooldown
        ) {
          // Successful blow!
          lastBlowTime.current = currentTime;
          setBlowCount((prev) => prev + 1);
          if (navigator.vibrate) {
            navigator.vibrate(100);
          }
          isCurrentlyBlowing.current = false;
        }
      }
    } else {
      // Volume below threshold
      isCurrentlyBlowing.current = false;
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  const requestMicrophoneAndStart = async () => {
    setBlowErrorMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);

      setBlowPermissionStatus("granted");
      setIsBlowActive(true);
      analyzeAudio();
    } catch (error) {
      setBlowErrorMessage(
        "Microphone access denied: " + (error as Error).message
      );
      setBlowPermissionStatus("denied");
    }
  };

  const stopBlowDetection = () => {
    setIsBlowActive(false);

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setCurrentVolume(0);
    isCurrentlyBlowing.current = false;
  };

  const resetBlowCounter = () => {
    setBlowCount(0);
    lastBlowTime.current = 0;
    blowStartTime.current = 0;
    isCurrentlyBlowing.current = false;
  };

  useEffect(() => {
    if (isActive) {
      window.addEventListener("devicemotion", handleDeviceMotion);
    } else {
      window.removeEventListener("devicemotion", handleDeviceMotion);
    }

    return () => {
      window.removeEventListener("devicemotion", handleDeviceMotion);
    };
  }, [isActive, sensitivity]);

  // Cleanup blow detection on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 via-pink-600 to-red-600">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-2xl p-8 space-y-6">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              🎉 Lucky Draw
            </h1>
            <p className="text-gray-600">Year End Party</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 bg-gray-100 p-2 rounded-xl">
            <button
              onClick={() => setActiveTab("shake")}
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                activeTab === "shake"
                  ? "bg-white text-purple-600 shadow-md"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              📱 Shake
            </button>
            <button
              onClick={() => setActiveTab("blow")}
              className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                activeTab === "blow"
                  ? "bg-white text-blue-600 shadow-md"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              🌬️ Blow
            </button>
          </div>
          {/* Shake Tab Content */}
          {activeTab === "shake" && (
            <>
              {/* Shake Counter Display */}
              <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl p-8 text-center shadow-lg">
                <p className="text-white text-sm font-medium mb-2">
                  Shake Count
                </p>
                <p className="text-7xl font-bold text-white mb-2">
                  {shakeCount}
                </p>
                <p className="text-white text-xs opacity-80">
                  {isActive ? "📱 Shake your device!" : "⏸️ Detection paused"}
                </p>
              </div>

              {/* Sensitivity Control */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Sensitivity
                  </label>
                  <span className="text-sm font-bold text-purple-600">
                    {sensitivity}
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="60"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  disabled={isActive}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Very Sensitive</span>
                  <span>Less Sensitive</span>
                </div>
                {isActive && (
                  <p className="text-xs text-amber-600 text-center">
                    ⚠️ Stop detection to adjust sensitivity
                  </p>
                )}
              </div>

              {/* Shake Cooldown */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Shake Cooldown
                  </label>
                  <span className="text-sm font-bold text-purple-600">
                    {cooldown}ms
                  </span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="1000"
                  value={cooldown}
                  onChange={(e) => setCooldown(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                  disabled={isActive}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>100ms</span>
                  <span>1000ms</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="space-y-3">
                {!isActive ? (
                  <button
                    onClick={requestPermissionAndStart}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                  >
                    🚀 Start Detection
                  </button>
                ) : (
                  <button
                    onClick={stopDetection}
                    className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                  >
                    ⏸️ Stop Detection
                  </button>
                )}

                <button
                  onClick={resetCounter}
                  className="w-full bg-white border-2 border-purple-600 text-purple-600 font-bold py-3 px-6 rounded-xl hover:bg-purple-50 transition-all duration-200"
                >
                  🔄 Reset Counter
                </button>
              </div>

              {/* Error Message */}
              {errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm text-red-700">{errorMessage}</p>
                </div>
              )}

              {/* Status Info */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Permission:</span>
                  <span
                    className={`font-medium ${
                      permissionStatus === "granted"
                        ? "text-green-600"
                        : permissionStatus === "denied"
                        ? "text-red-600"
                        : "text-gray-600"
                    }`}
                  >
                    {permissionStatus === "granted"
                      ? "✅ Granted"
                      : permissionStatus === "denied"
                      ? "❌ Denied"
                      : "⏳ Not requested"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Status:</span>
                  <span
                    className={`font-medium ${
                      isActive ? "text-green-600" : "text-gray-600"
                    }`}
                  >
                    {isActive ? "🟢 Active" : "⚪ Inactive"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Cooldown:</span>
                  <span className="font-medium text-gray-800">
                    {cooldown}ms
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Blow Tab Content */}
          {activeTab === "blow" && (
            <>
              {/* Blow Counter Display */}
              <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl p-8 text-center shadow-lg">
                <p className="text-white text-sm font-medium mb-2">
                  Blow Count
                </p>
                <p className="text-7xl font-bold text-white mb-2">
                  {blowCount}
                </p>
                <p className="text-white text-xs opacity-80">
                  {isBlowActive
                    ? "🌬️ Blow into microphone!"
                    : "⏸️ Detection paused"}
                </p>
              </div>

              {/* Volume Indicator */}
              {isBlowActive && (
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      Current Volume
                    </span>
                    <span className="text-sm font-bold text-blue-600">
                      {currentVolume}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full transition-all duration-100"
                      style={{
                        width: `${(Math.min(currentVolume, 255) / 255) * 100}%`,
                      }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 text-center">
                    Threshold: {blowThreshold}
                  </p>
                </div>
              )}

              {/* Blow Threshold Control */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Blow Threshold
                  </label>
                  <span className="text-sm font-bold text-blue-600">
                    {blowThreshold}
                  </span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="150"
                  value={blowThreshold}
                  onChange={(e) => setBlowThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  disabled={isBlowActive}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Very Sensitive (30)</span>
                  <span>Less Sensitive (150)</span>
                </div>
                {isBlowActive && (
                  <p className="text-xs text-amber-600 text-center">
                    ⚠️ Stop detection to adjust threshold
                  </p>
                )}
              </div>

              {/* Blow Duration Control */}
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
                  min="200"
                  max="2000"
                  step="100"
                  value={blowDuration}
                  onChange={(e) => setBlowDuration(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  disabled={isBlowActive}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>200ms</span>
                  <span>2000ms</span>
                </div>
              </div>

              {/* Blow Cooldown Control */}
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
                  min="500"
                  max="3000"
                  step="100"
                  value={blowCooldown}
                  onChange={(e) => setBlowCooldown(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  disabled={isBlowActive}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>500ms</span>
                  <span>3000ms</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="space-y-3">
                {!isBlowActive ? (
                  <button
                    onClick={requestMicrophoneAndStart}
                    className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                  >
                    🎤 Start Detection
                  </button>
                ) : (
                  <button
                    onClick={stopBlowDetection}
                    className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
                  >
                    ⏸️ Stop Detection
                  </button>
                )}

                <button
                  onClick={resetBlowCounter}
                  className="w-full bg-white border-2 border-blue-600 text-blue-600 font-bold py-3 px-6 rounded-xl hover:bg-blue-50 transition-all duration-200"
                >
                  🔄 Reset Counter
                </button>
              </div>

              {/* Error Message */}
              {blowErrorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm text-red-700">{blowErrorMessage}</p>
                </div>
              )}

              {/* Status Info */}
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
                  <span className="text-gray-600">Cooldown:</span>
                  <span className="font-medium text-gray-800">
                    {blowCooldown}ms
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-white text-xs opacity-75 mt-1">
            {activeTab === "shake"
              ? "Using DeviceMotionEvent API"
              : "Using Web Audio API"}
          </p>
        </div>
      </div>
    </main>
  );
}
