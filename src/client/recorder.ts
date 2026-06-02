export interface RecordingResult {
  blob: Blob;
  durationMs: number;
}

export class PushToTalkRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: BlobPart[] = [];
  private startedAt = 0;

  get isRecording() {
    return this.recorder?.state === "recording";
  }

  async start() {
    if (this.isRecording) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    this.chunks = [];
    this.startedAt = Date.now();
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.recorder.start();
  }

  async stop(): Promise<RecordingResult> {
    if (!this.recorder || this.recorder.state !== "recording") {
      throw new Error("There is no active recording to stop.");
    }

    const recorder = this.recorder;
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });

    recorder.stop();
    await stopped;
    this.stream?.getTracks().forEach((track) => track.stop());

    return {
      blob: new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }),
      durationMs: Date.now() - this.startedAt
    };
  }
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error?: string;
  readonly message?: string;
}

export interface SpeechRecognizerCallbacks {
  onTranscript?: (transcript: string) => void;
  onError?: (message: string) => void;
  language?: string;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export class PushToTalkSpeechRecognizer {
  private recognition?: SpeechRecognitionLike;
  private finalTranscript = "";
  private interimTranscript = "";
  private started = false;

  static isSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  get transcript() {
    return [this.finalTranscript, this.interimTranscript].join(" ").trim();
  }

  start(callbacks: SpeechRecognizerCallbacks = {}) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      throw new Error("Browser speech recognition is not available here. Use OpenAI cloud voice mode instead.");
    }

    this.finalTranscript = "";
    this.interimTranscript = "";
    this.started = true;
    this.recognition = new Recognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang =
      callbacks.language && callbacks.language !== "auto"
        ? callbacks.language
        : navigator.language || "en-US";
    if ("maxAlternatives" in this.recognition) {
      (this.recognition as SpeechRecognitionLike & { maxAlternatives: number }).maxAlternatives = 3;
    }
    this.recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          this.finalTranscript += ` ${result[0].transcript}`;
        } else {
          interim += ` ${result[0].transcript}`;
        }
      }
      this.interimTranscript = interim;
      callbacks.onTranscript?.(this.transcript);
    };
    this.recognition.onerror = (event) => {
      this.started = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        callbacks.onError?.(
          "Voice permission was blocked by the browser. Allow microphone access for 127.0.0.1, or open this app in Chrome where speech recognition permissions are more reliable."
        );
        return;
      }
      if (event.error === "no-speech") {
        callbacks.onError?.(
          "The browser did not detect speech. Try again closer to the microphone, or use the typed fallback."
        );
        return;
      }
      callbacks.onError?.(
        event.error
          ? `Speech recognition error: ${event.error}.`
          : event.message || "Speech recognition stopped without a transcript."
      );
    };
    this.recognition.start();
  }

  stop(): Promise<string> {
    if (!this.recognition || !this.started) {
      return Promise.resolve(this.transcript);
    }

    return new Promise((resolve) => {
      const recognition = this.recognition;
      if (!recognition) {
        resolve(this.transcript);
        return;
      }

      recognition.onend = () => {
        this.started = false;
        resolve(this.transcript);
      };
      recognition.stop();
      window.setTimeout(() => resolve(this.transcript), 1200);
    });
  }
}

export class MicActivityMonitor {
  private stream?: MediaStream;
  private audioContext?: AudioContext;
  private animationFrame = 0;

  async start(onLevel: (level: number) => void) {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      onLevel(Math.min(1, rms * 8));
      this.animationFrame = window.requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    if (this.animationFrame) window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
  }
}
