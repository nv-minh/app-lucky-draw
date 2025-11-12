"use client";

import { useState, useEffect, useRef } from "react";

export default function BlowDetection() {
  const [blowCount, setBlowCount] = useState(0);
  const [blowThreshold, setBlowThreshold] = useState(30);
  const [blowDuration, setBlowDuration] = useState(300);
  const [blowCooldown, setBlowCooldown] = useState(500);
  const [isBlowActive, setIsBlowActive] = useState(false);
  const [blowPermissionStatus, setBlowPermissionStatus] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [blowErrorMessage, setBlowErrorMessage] = useState("");
  const [currentVolume, setCurrentVolume] = useState(0);

  // Refs for blow tracking
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const blowIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBlowTime = useRef(0);
  const blowStartTime = useRef(0);
  const isCurrentlyBlowing = useRef(false);
  const hasCountedThisBlow = useRef(false);

  // Blow detection with duration requirement
  const checkBlowing = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    setCurrentVolume(Math.round(average));

    const currentTime = Date.now();

    // Check if volume exceeds threshold
    if (average > blowThreshold) {
      if (!isCurrentlyBlowing.current) {
        // Start of potential blow - record start time
        isCurrentlyBlowing.current = true;
        hasCountedThisBlow.current = false;
        blowStartTime.current = currentTime;
      } else {
        // Continue blowing - check if duration requirement is met
        const blowingDuration = currentTime - blowStartTime.current;

        // Only count if:
        // 1. We've been blowing for at least the minimum duration
        // 2. Enough time has passed since last successful blow (cooldown)
        if (
          blowingDuration >= blowDuration &&
          currentTime - lastBlowTime.current > blowCooldown &&
          !hasCountedThisBlow.current
        ) {
          // Successful blow detected!
          lastBlowTime.current = currentTime;
          setBlowCount((prev) => prev + 1);

          // Visual feedback
          if (navigator.vibrate) {
            navigator.vibrate(100);
          }

          // Reset to prevent multiple counts from same blow
          hasCountedThisBlow.current = true;
        }
      }
    } else {
      // Volume dropped below threshold - reset blow tracking
      isCurrentlyBlowing.current = false;
      blowStartTime.current = 0;
      hasCountedThisBlow.current = false;
    }
  };

  const requestMicrophoneAndStart = async () => {
    setBlowErrorMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      await audioContext.resume();

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      analyser.connect(silent);
      silent.connect(audioContext.destination);

      setBlowPermissionStatus("granted");
      setIsBlowActive(true);

      // Check for blowing every 200ms
      blowIntervalRef.current = setInterval(checkBlowing, 200);
    } catch (error) {
      setBlowErrorMessage(
        "Microphone access denied: " + (error as Error).message
      );
      setBlowPermissionStatus("denied");
    }
  };

  const stopBlowDetection = () => {
    setIsBlowActive(false);

    if (blowIntervalRef.current) {
      clearInterval(blowIntervalRef.current);
      blowIntervalRef.current = null;
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
    blowStartTime.current = 0;
    hasCountedThisBlow.current = false;
  };

  const resetBlowCounter = () => {
    setBlowCount(0);
    lastBlowTime.current = 0;
    blowStartTime.current = 0;
    isCurrentlyBlowing.current = false;
    hasCountedThisBlow.current = false;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (blowIntervalRef.current) {
        clearInterval(blowIntervalRef.current);
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
    <>
      {/* Blow Counter Display */}
      <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl p-8 text-center shadow-lg">
        <p className="text-white text-sm font-medium mb-2">Blow Count</p>
        <p className="text-7xl font-bold text-white mb-2">{blowCount}</p>
        <p className="text-white text-xs opacity-80">
          {isBlowActive ? "🌬️ Blow into microphone!" : "⏸️ Detection paused"}
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
                width: `${Math.min((currentVolume / 255) * 100, 100)}%`,
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
          min="10"
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
