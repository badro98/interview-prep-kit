import { useCallback, useEffect, useRef, useState } from "react";

// Audio capture via MediaRecorder. Pairs with useSpeechRecognition (live transcript).
//
// start() requests the mic and begins recording; stop() resolves with the recorded
// { blob, type, durationMs }. Mic denial surfaces via `error`.

export function isRecordingSupported() {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
  );
}

function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return "";
}

export function useRecorder() {
  const supported = isRecordingSupported();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);

  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const levelFrameRef = useRef(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef(null);
  const [micLevel, setMicLevel] = useState(0);

  const stopLevelMonitor = useCallback(() => {
    if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current);
    levelFrameRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setMicLevel(0);
  }, []);

  const startLevelMonitor = useCallback((stream) => {
    stopLevelMonitor();
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = ctx;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round(avg * 1.4)));
        levelFrameRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      /* level meter is optional */
    }
  }, [stopLevelMonitor]);

  const cleanupStream = useCallback(() => {
    stopLevelMonitor();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [stopLevelMonitor]);

  const start = useCallback(async () => {
    if (!supported) {
      setError("Recording isn't supported in this browser. Use Chrome.");
      return false;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startLevelMonitor(stream);
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recRef.current = rec;
      rec.start();
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      tickRef.current = setInterval(
        () => setElapsedMs(Date.now() - startedAtRef.current),
        200
      );
      setRecording(true);
      return true;
    } catch (e) {
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
        setError("Microphone permission denied. Allow mic access and try again.");
      } else if (e?.name === "NotFoundError") {
        setError("No microphone found.");
      } else {
        setError(`Could not start recording: ${e?.message || e}`);
      }
      cleanupStream();
      return false;
    }
  }, [supported, cleanupStream, startLevelMonitor]);

  /** Returns Promise<{ blob, type, durationMs } | null>. */
  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      clearInterval(tickRef.current);
      if (!rec || rec.state === "inactive") {
        setRecording(false);
        cleanupStream();
        resolve(null);
        return;
      }
      const durationMs = Date.now() - startedAtRef.current;
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        setRecording(false);
        cleanupStream();
        resolve({ blob, type, durationMs });
      };
      rec.stop();
    });
  }, [cleanupStream]);

  useEffect(() => {
    return () => {
      clearInterval(tickRef.current);
      cleanupStream();
    };
  }, [cleanupStream]);

  return { supported, recording, error, elapsedMs, micLevel, start, stop };
}
