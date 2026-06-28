import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API transcription, isolated behind one hook.
//
// This is the audio feature's transcription primitive — Phase 3 (record + score)
// will reuse it. Swapping in Whisper later is a one-file change here.
//
// Notes (Chrome): uses webkitSpeechRecognition, continuous + interim results.
// Mic permission is requested on start; denial surfaces via `error`.

function getRecognizer() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechSupported() {
  return !!getRecognizer();
}

/**
 * @param {(finalText: string) => void} onFinalText
 *   Called with each finalized transcript chunk (append it to your field).
 * @returns {{ supported, listening, interim, error, start, stop, toggle }}
 */
export function useSpeechRecognition(onFinalText) {
  const Recognizer = getRecognizer();
  const supported = !!Recognizer;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const recRef = useRef(null);
  const onFinalRef = useRef(onFinalText);
  onFinalRef.current = onFinalText;

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!supported) {
      setError("Speech recognition isn't supported in this browser. Use Chrome.");
      return;
    }
    setError("");

    const rec = new Recognizer();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0]?.transcript || "";
        if (res.isFinal) {
          const finalText = text.trim();
          if (finalText) onFinalRef.current?.(finalText + " ");
        } else {
          interimText += text;
        }
      }
      setInterim(interimText);
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone permission denied. Allow mic access and try again.");
      } else if (e.error === "no-speech") {
        setError("No speech detected — try again.");
      } else if (e.error === "network") {
        setError(
          "Live transcription couldn't reach Google's speech service (network). " +
            "You can still record — Gemini scoring listens to the audio directly, no transcript needed."
        );
      } else if (e.error !== "aborted") {
        setError(`Speech error: ${e.error}`);
      }
    };

    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if already started; ignore.
    }
  }, [Recognizer, supported]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return { supported, listening, interim, error, start, stop, toggle };
}
