// AssemblyAI transcription with speaker diarization.

const BASE = "https://api.assemblyai.com/v2";

function apiKey() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    throw new Error(
      "ASSEMBLYAI_API_KEY is not set. Add it to .env or rely on Gemini fallback."
    );
  }
  return key;
}

export function isConfigured() {
  return !!process.env.ASSEMBLYAI_API_KEY;
}

async function uploadBuffer(buffer) {
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: {
      authorization: apiKey(),
      "content-type": "application/octet-stream",
    },
    body: buffer,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AssemblyAI upload failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.upload_url;
}

async function createTranscript(uploadUrl) {
  const res = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: {
      authorization: apiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speaker_labels: true,
      speakers_expected: 2,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AssemblyAI transcript request failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function pollTranscript(id, { maxWaitMs = 30 * 60 * 1000, intervalMs = 3000, onPoll } = {}) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const res = await fetch(`${BASE}/transcript/${id}`, {
      headers: { authorization: apiKey() },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AssemblyAI poll failed (${res.status}): ${err}`);
    }
    const data = await res.json();
    const elapsed = Date.now() - started;
    const ratio = Math.min(elapsed / maxWaitMs, 0.95);
    onPoll?.({ status: data.status, elapsedMs: elapsed, ratio });
    if (data.status === "completed") return data;
    if (data.status === "error") {
      throw new Error(data.error || "AssemblyAI transcription failed.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("AssemblyAI transcription timed out.");
}

function parseUtterances(transcript) {
  const utterances = transcript.utterances || [];
  const speakerIds = [...new Set(utterances.map((u) => u.speaker))].sort();
  const speakers = speakerIds.map((id) => ({
    id: String(id),
    label: `Speaker ${id}`,
  }));
  const segments = utterances.map((u) => ({
    speaker: String(u.speaker),
    startMs: u.start,
    endMs: u.end,
    text: u.text,
  }));
  const durationMs =
    transcript.audio_duration != null
      ? Math.round(transcript.audio_duration * 1000)
      : segments.at(-1)?.endMs || 0;

  return { segments, speakers, durationMs };
}

/**
 * Transcribe audio buffer with speaker labels.
 * @returns {{ segments, speakers, durationMs, provider: 'assemblyai' }}
 */
export async function transcribeWithDiarization(buffer, { onProgress } = {}) {
  onProgress?.({ phase: "Uploading to AssemblyAI", progress: 12 });
  const uploadUrl = await uploadBuffer(buffer);
  onProgress?.({ phase: "Transcribing audio", progress: 18 });
  const job = await createTranscript(uploadUrl);
  const result = await pollTranscript(job.id, {
    onPoll: ({ ratio }) => {
      const progress = Math.round(18 + ratio * 57);
      onProgress?.({ phase: "Transcribing audio", progress });
    },
  });
  const parsed = parseUtterances(result);
  onProgress?.({ phase: "Transcription complete", progress: 75 });
  return { ...parsed, provider: "assemblyai" };
}
