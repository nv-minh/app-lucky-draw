"use client";

import { useState } from "react";
import ShakeDetection from "./components/ShakeDetection";
import BlowDetection from "./components/BlowDetection";

type TabType = "shake" | "blow";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("shake");

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
          {activeTab === "shake" && <ShakeDetection />}

          {/* Blow Tab Content */}
          {activeTab === "blow" && <BlowDetection />}
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
