"use client";

import { useState, useEffect, useRef } from "react";

export default function ShakeDetection() {
  const [shakeCount, setShakeCount] = useState(0);
  const [sensitivity, setSensitivity] = useState(30);
  const [cooldown, setCooldown] = useState(500);
  const [isActive, setIsActive] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<
    "unknown" | "granted" | "denied"
  >("unknown");
  const [errorMessage, setErrorMessage] = useState("");
  const [isShaking, setIsShaking] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  // Target shake count to reach 100% (adjustable)
  const TARGET_SHAKES = 25;

  // Refs for tracking acceleration and preventing bounce
  const lastX = useRef(0);
  const lastY = useRef(0);
  const lastZ = useRef(0);
  const lastShakeTime = useRef(0);
  const shakeAnimationTimeout = useRef<NodeJS.Timeout | null>(null);

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

      setShakeCount((prev) => {
        const newCount = prev + 1;

        // Check if reached target
        if (newCount >= TARGET_SHAKES && !isCompleted) {
          setIsCompleted(true);
        }

        return newCount;
      });

      // Trigger shake animation
      setIsShaking(true);
      if (shakeAnimationTimeout.current) {
        clearTimeout(shakeAnimationTimeout.current);
      }
      shakeAnimationTimeout.current = setTimeout(() => {
        setIsShaking(false);
      }, 500);

      // Visual feedback - vibrate if available
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }
    }
  };

  const requestPermissionAndStart = async () => {
    setErrorMessage("");

    try {
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
    setIsShaking(false);
  };

  useEffect(() => {
    if (isActive) {
      window.addEventListener("devicemotion", handleDeviceMotion);
    } else {
      window.removeEventListener("devicemotion", handleDeviceMotion);
    }

    return () => {
      window.removeEventListener("devicemotion", handleDeviceMotion);
      if (shakeAnimationTimeout.current) {
        clearTimeout(shakeAnimationTimeout.current);
      }
    };
  }, [isActive, sensitivity]);

  return (
    <>
      <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl p-8 text-center shadow-lg">
        <p className="text-white text-sm font-medium mb-2">Shake Count</p>
        <p className="text-7xl font-bold text-white mb-2">{shakeCount}</p>
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
          <span className="font-medium text-gray-800">{cooldown}ms</span>
        </div>
      </div>
    </>
  );
}
