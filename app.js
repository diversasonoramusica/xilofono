"use strict";

const NOTE_NAMES = [
  "C",
  "C#/Db",
  "D",
  "D#/Eb",
  "E",
  "F",
  "F#/Gb",
  "G",
  "G#/Ab",
  "A",
  "A#/Bb",
  "B",
];

const SOLFEGE_NOTE_NAMES = [
  "Do",
  "Do#/Reb",
  "Re",
  "Re#/Mib",
  "Mi",
  "Fa",
  "Fa#/Solb",
  "Sol",
  "Sol#/Lab",
  "La",
  "La#/Sib",
  "Si",
];

const NOTATION_STORAGE_KEY = "digitalXylophoneNotation";
const DISPLAY_STORAGE_KEY = "digitalXylophoneDisplayOptions";

const SCALE_INTERVALS = {
  chromatic: {
    label: "Cromática",
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  major: {
    label: "Mayor",
    intervals: [0, 2, 4, 5, 7, 9, 11],
  },
  naturalMinor: {
    label: "Menor natural",
    intervals: [0, 2, 3, 5, 7, 8, 10],
  },
  majorPentatonic: {
    label: "Pentatónica mayor",
    intervals: [0, 2, 4, 7, 9],
  },
  minorPentatonic: {
    label: "Pentatónica menor",
    intervals: [0, 3, 5, 7, 10],
  },
  blues: {
    label: "Blues",
    intervals: [0, 3, 5, 6, 7, 10],
  },
  dorian: {
    label: "Dórica",
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
  mixolydian: {
    label: "Mixolidia",
    intervals: [0, 2, 4, 5, 7, 9, 10],
  },
  hirajoshi: {
    label: "Japonesa / Hirajoshi",
    intervals: [0, 2, 3, 7, 8],
  },
  custom: {
    label: "Escala personalizada",
    intervals: [],
  },
};

const DEGREE_LABELS = {
  0: "1",
  1: "b2",
  2: "2",
  3: "b3",
  4: "3",
  5: "4",
  6: "b5",
  7: "5",
  8: "b6",
  9: "6",
  10: "b7",
  11: "7",
};

const CHROMA_NOTE_COLORS = [
  "#e53935",
  "#f4511e",
  "#fb8c00",
  "#fbc02d",
  "#fdd835",
  "#8bc34a",
  "#4F8A64",
  "#00bcd4",
  "#4E5FD1",
  "#8e44ad",
  "#d84fb8",
  "#ec407a",
];

const LOWER_OCTAVE_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "Enter"];
const UPPER_OCTAVE_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"];
const BASE_MIDI_NOTE = 60; // C4, a comfortable starting register for children.

const state = {
  selectedScale: "major",
  rootIndex: 0,
  octaveRange: 1,
  customIntervals: [],
  notation: "solfege",
  showDegrees: true,
  showKeyboardShortcuts: false,
  notes: [],
};

let audioContext = null;
let masterGain = null;
let audioUnlockPromise = null;

const elements = {
  scaleSelect: document.querySelector("#scale-select"),
  rootSelect: document.querySelector("#root-select"),
  notationSelect: document.querySelector("#notation-select"),
  rangeSelect: document.querySelector("#range-select"),
  showDegrees: document.querySelector("#show-degrees"),
  showKeyboardShortcuts: document.querySelector("#show-keyboard-shortcuts"),
  audioUnlock: document.querySelector("#audio-unlock"),
  customPanel: document.querySelector("#custom-panel"),
  clearCustomScale: document.querySelector("#clear-custom-scale"),
  customNoteToggles: document.querySelector("#custom-note-toggles"),
  xylophone: document.querySelector("#xylophone"),
  emptyMessage: document.querySelector("#empty-message"),
  scaleSummary: document.querySelector("#scale-summary"),
};

function midiToFrequency(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function normalizePitchClass(value) {
  return ((value % 12) + 12) % 12;
}

function getDisplayNoteName(pitchClass) {
  const labels = state.notation === "english" ? NOTE_NAMES : SOLFEGE_NOTE_NAMES;
  return labels[normalizePitchClass(pitchClass)];
}

function loadNotationPreference() {
  try {
    const savedNotation = localStorage.getItem(NOTATION_STORAGE_KEY);
    state.notation = savedNotation === "english" ? "english" : "solfege";
  } catch {
    state.notation = "solfege";
  }
}

function saveNotationPreference() {
  try {
    localStorage.setItem(NOTATION_STORAGE_KEY, state.notation);
  } catch {
    // The app still works when storage is unavailable.
  }
}

function loadDisplayPreferences() {
  try {
    const savedPreferences = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY));

    state.showDegrees = typeof savedPreferences?.showDegrees === "boolean"
      ? savedPreferences.showDegrees
      : true;
    state.showKeyboardShortcuts = typeof savedPreferences?.showKeyboardShortcuts === "boolean"
      ? savedPreferences.showKeyboardShortcuts
      : false;
  } catch {
    state.showDegrees = true;
    state.showKeyboardShortcuts = false;
  }
}

function saveDisplayPreferences() {
  try {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({
      showDegrees: state.showDegrees,
      showKeyboardShortcuts: state.showKeyboardShortcuts,
    }));
  } catch {
    // Display preferences are optional when storage is unavailable.
  }
}

function getActiveIntervals() {
  if (state.selectedScale === "custom") {
    return [...state.customIntervals].sort((a, b) => a - b);
  }

  return SCALE_INTERVALS[state.selectedScale].intervals;
}

function transposeInterval(rootIndex, interval) {
  return normalizePitchClass(rootIndex + interval);
}

function generateScaleNotes(rootIndex, intervals, octaveRole, keyboardKeys) {
  const octaveOffset = octaveRole === "high" ? 12 : 0;

  return intervals.map((interval, index) => {
    const pitchClass = transposeInterval(rootIndex, interval);
    const midiNote = BASE_MIDI_NOTE + rootIndex + interval + octaveOffset;

    return {
      id: `${octaveRole}-${pitchClass}-${index}-${interval}`,
      noteName: NOTE_NAMES[pitchClass],
      pitchClass,
      interval,
      degree: DEGREE_LABELS[normalizePitchClass(interval)],
      midiNote,
      frequency: midiToFrequency(midiNote),
      keyboardKey: keyboardKeys[index] || "",
      octaveRole,
    };
  });
}

function updateScale() {
  const intervals = getActiveIntervals();
  const lowNotes = generateScaleNotes(state.rootIndex, intervals, "low", LOWER_OCTAVE_KEYS);

  if (state.octaveRange === 2) {
    const highNotes = generateScaleNotes(state.rootIndex, intervals, "high", UPPER_OCTAVE_KEYS);
    state.notes = [...highNotes, ...lowNotes];
    return;
  }

  state.notes = lowNotes;
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.68;
    masterGain.connect(audioContext.destination);
    audioContext.addEventListener?.("statechange", updateAudioButton);
  }

  return audioContext;
}

function updateAudioButton() {
  const isReady = audioContext?.state === "running";

  elements.audioUnlock.textContent = isReady ? "Sonido activado" : "Activar sonido";
  elements.audioUnlock.disabled = Boolean(isReady);
  elements.audioUnlock.classList.toggle("is-active", Boolean(isReady));
  elements.audioUnlock.setAttribute("aria-pressed", String(Boolean(isReady)));
}

async function unlockAudio() {
  if (audioContext?.state === "running") {
    updateAudioButton();
    return true;
  }

  if (audioUnlockPromise) {
    return audioUnlockPromise;
  }

  const unlockTask = (async () => {
    try {
      const context = ensureAudioContext();

      if (context.state !== "running") {
        await context.resume();
      }

      updateAudioButton();
      return context.state === "running";
    } catch {
      updateAudioButton();
      return false;
    }
  })();

  audioUnlockPromise = unlockTask;

  try {
    return await unlockTask;
  } finally {
    if (audioUnlockPromise === unlockTask) {
      audioUnlockPromise = null;
    }
  }
}

async function playXylophoneTone(frequency) {
  const isReady = await unlockAudio();

  if (!isReady) {
    return;
  }

  const now = audioContext.currentTime;
  const output = audioContext.createGain();
  const body = audioContext.createOscillator();
  const bodyGain = audioContext.createGain();
  const harmonic = audioContext.createOscillator();
  const harmonicGain = audioContext.createGain();
  const transient = audioContext.createOscillator();
  const transientGain = audioContext.createGain();

  body.type = "sine";
  body.frequency.setValueAtTime(frequency, now);

  harmonic.type = "triangle";
  harmonic.frequency.setValueAtTime(frequency * 2.98, now);

  transient.type = "sine";
  transient.frequency.setValueAtTime(frequency * 5.4, now);

  output.gain.setValueAtTime(0.9, now);

  bodyGain.gain.setValueAtTime(0.0001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.62, now + 0.008);
  bodyGain.gain.exponentialRampToValueAtTime(0.24, now + 0.12);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

  harmonicGain.gain.setValueAtTime(0.0001, now);
  harmonicGain.gain.exponentialRampToValueAtTime(0.14, now + 0.006);
  harmonicGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.27);

  transientGain.gain.setValueAtTime(0.0001, now);
  transientGain.gain.exponentialRampToValueAtTime(0.055, now + 0.002);
  transientGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

  body.connect(bodyGain);
  harmonic.connect(harmonicGain);
  transient.connect(transientGain);
  bodyGain.connect(output);
  harmonicGain.connect(output);
  transientGain.connect(output);
  output.connect(masterGain);

  body.start(now);
  harmonic.start(now);
  transient.start(now);

  transient.stop(now + 0.04);
  harmonic.stop(now + 0.3);
  body.stop(now + 0.75);
}

function animateBar(bar) {
  bar.classList.remove("is-playing");
  window.requestAnimationFrame(() => {
    bar.classList.add("is-playing");
    window.setTimeout(() => {
      bar.classList.remove("is-playing");
    }, 150);
  });
}

function playNoteAtIndex(index) {
  const note = state.notes[index];
  const bar = elements.xylophone.querySelector(`[data-note-index="${index}"]`);

  if (!note) {
    return;
  }

  playXylophoneTone(note.frequency);

  if (bar) {
    animateBar(bar);
  }
}

function renderControls() {
  elements.scaleSelect.innerHTML = Object.entries(SCALE_INTERVALS)
    .map(([value, scale]) => `<option value="${value}">${scale.label}</option>`)
    .join("");

  elements.rootSelect.innerHTML = NOTE_NAMES.map((_, index) => {
    return `<option value="${index}">${getDisplayNoteName(index)}</option>`;
  }).join("");

  elements.scaleSelect.value = state.selectedScale;
  elements.rootSelect.value = String(state.rootIndex);
  elements.notationSelect.value = state.notation;
  elements.rangeSelect.value = String(state.octaveRange);
  elements.showDegrees.checked = state.showDegrees;
  elements.showKeyboardShortcuts.checked = state.showKeyboardShortcuts;
}

function renderCustomToggles() {
  elements.customNoteToggles.innerHTML = "";

  NOTE_NAMES.forEach((_, interval) => {
    const pitchClass = normalizePitchClass(state.rootIndex + interval);
    const displayName = getDisplayNoteName(pitchClass);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-toggle";
    button.textContent = displayName;
    button.setAttribute("aria-pressed", String(state.customIntervals.includes(interval)));
    button.setAttribute("aria-label", `${displayName}, intervalo ${interval} desde la tónica`);
    button.addEventListener("click", () => {
      toggleCustomInterval(interval);
    });
    elements.customNoteToggles.append(button);
  });

  elements.clearCustomScale.disabled = state.customIntervals.length === 0;
}

function createBar(note, noteIndex, visualIndex) {
  const bar = document.createElement("button");
  const color = CHROMA_NOTE_COLORS[note.pitchClass];
  const offsetStep = state.octaveRange === 2 ? 3 : 7;
  const offset = `${visualIndex * offsetStep}px`;
  const displayName = getDisplayNoteName(note.pitchClass);
  const octaveLabel = note.octaveRole === "high" ? "aguda" : "grave";
  let pointerTriggered = false;
  let pointerResetTimer = null;

  bar.type = "button";
  bar.className = "bar";
  bar.dataset.noteIndex = String(noteIndex);
  bar.dataset.pitchClass = String(note.pitchClass);
  bar.dataset.interval = String(note.interval);
  bar.dataset.midiNote = String(note.midiNote);
  bar.dataset.frequency = String(note.frequency);
  bar.dataset.keyboardKey = note.keyboardKey;
  bar.dataset.octaveRole = note.octaveRole;
  bar.style.setProperty("--bar-color", color);
  bar.style.setProperty("--bar-offset", offset);
  bar.setAttribute("aria-label", `Tocar ${displayName}, octava ${octaveLabel}`);

  bar.innerHTML = `
    <span class="bar-content">
      <span class="note-label">${displayName}</span>
      <span class="bar-meta">
        <span class="degree-label"${state.showDegrees ? "" : " hidden"}>${note.degree}</span>
        ${note.keyboardKey ? `<span class="key-label"${state.showKeyboardShortcuts ? "" : " hidden"}>${note.keyboardKey.toUpperCase()}</span>` : ""}
      </span>
    </span>
  `;

  bar.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    window.clearTimeout(pointerResetTimer);
    pointerTriggered = true;
    bar.setPointerCapture?.(event.pointerId);
    playNoteAtIndex(noteIndex);
  });

  bar.addEventListener("pointerup", () => {
    pointerResetTimer = window.setTimeout(() => {
      pointerTriggered = false;
    }, 0);
  });

  bar.addEventListener("pointercancel", () => {
    window.clearTimeout(pointerResetTimer);
    pointerTriggered = false;
  });

  bar.addEventListener("click", (event) => {
    if (pointerTriggered) {
      window.clearTimeout(pointerResetTimer);
      pointerTriggered = false;
      event.preventDefault();
      return;
    }
    playNoteAtIndex(noteIndex);
  });

  return bar;
}

function renderBars() {
  const notesPerOctave = state.notes.filter((note) => note.octaveRole === "low").length;
  const hasNotes = notesPerOctave > 0;

  elements.xylophone.innerHTML = "";
  elements.xylophone.classList.toggle("is-two-octaves", state.octaveRange === 2);
  elements.xylophone.style.setProperty("--bar-count", String(Math.max(notesPerOctave, 1)));
  elements.xylophone.dataset.noteCount = String(state.notes.length);
  elements.emptyMessage.hidden = hasNotes;
  elements.xylophone.hidden = !hasNotes;

  if (state.octaveRange === 1) {
    state.notes.forEach((note, index) => {
      elements.xylophone.append(createBar(note, index, index));
    });
    return;
  }

  [
    { role: "high", label: "Aguda" },
    { role: "low", label: "Grave" },
  ].forEach(({ role, label }) => {
    const row = document.createElement("div");
    const rowLabel = document.createElement("span");
    const bars = document.createElement("div");
    const rowNotes = state.notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.octaveRole === role);

    row.className = `octave-row octave-row--${role}`;
    rowLabel.className = "octave-label";
    rowLabel.textContent = label;
    bars.className = "octave-bars";
    bars.style.setProperty("--bar-count", String(Math.max(rowNotes.length, 1)));
    bars.setAttribute("role", "group");
    bars.setAttribute("aria-label", `Octava ${label.toLowerCase()}`);

    rowNotes.forEach(({ note, index }, visualIndex) => {
      bars.append(createBar(note, index, visualIndex));
    });

    row.append(rowLabel, bars);
    elements.xylophone.append(row);
  });
}

function updateSummary() {
  const scaleLabel = SCALE_INTERVALS[state.selectedScale].label;
  const rootLabel = getDisplayNoteName(state.rootIndex);
  const summaryNotes = state.notes.filter((note) => note.octaveRole === "low");

  if (summaryNotes.length === 0) {
    elements.scaleSummary.textContent = `${rootLabel} · ${scaleLabel}: sin notas seleccionadas`;
    return;
  }

  elements.scaleSummary.textContent = `${rootLabel} · ${scaleLabel}: ${summaryNotes
    .map((note) => getDisplayNoteName(note.pitchClass))
    .join(", ")}`;
}

function updateUI() {
  updateScale();
  elements.customPanel.hidden = state.selectedScale !== "custom";
  renderCustomToggles();
  renderBars();
  updateSummary();
}

function toggleCustomInterval(interval) {
  // Custom notes stay as intervals above the selected tonic, so the pattern remains movable.
  // Example: selecting intervals [0, 3, 5, 7, 10] transposes intact when the tonic changes.
  if (state.customIntervals.includes(interval)) {
    state.customIntervals = state.customIntervals.filter((item) => item !== interval);
  } else {
    state.customIntervals = [...state.customIntervals, interval].sort((a, b) => a - b);
  }

  updateUI();
}

function clearCustomScale() {
  state.customIntervals = [];
  updateUI();
}

function handleAudioUnlock() {
  void unlockAudio();
}

function bindEvents() {
  elements.scaleSelect.addEventListener("change", (event) => {
    state.selectedScale = event.target.value;
    updateUI();
  });

  elements.rootSelect.addEventListener("change", (event) => {
    state.rootIndex = Number(event.target.value);
    updateUI();
  });

  elements.notationSelect.addEventListener("change", (event) => {
    state.notation = event.target.value === "english" ? "english" : "solfege";
    saveNotationPreference();
    renderControls();
    updateUI();
  });

  elements.rangeSelect.addEventListener("change", (event) => {
    state.octaveRange = event.target.value === "2" ? 2 : 1;
    updateUI();
  });

  elements.showDegrees.addEventListener("change", () => {
    state.showDegrees = elements.showDegrees.checked;
    saveDisplayPreferences();
    renderBars();
  });

  elements.showKeyboardShortcuts.addEventListener("change", () => {
    state.showKeyboardShortcuts = elements.showKeyboardShortcuts.checked;
    saveDisplayPreferences();
    renderBars();
  });

  elements.clearCustomScale.addEventListener("click", clearCustomScale);
  elements.audioUnlock.addEventListener("pointerdown", handleAudioUnlock);
  elements.audioUnlock.addEventListener("touchend", handleAudioUnlock, { passive: true });
  elements.audioUnlock.addEventListener("click", handleAudioUnlock);

  window.addEventListener(
    "pointerdown",
    handleAudioUnlock,
    { once: true, capture: true }
  );
  window.addEventListener("touchend", handleAudioUnlock, { once: true, capture: true, passive: true });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    const target = event.target;
    const isToneBar = target instanceof HTMLButtonElement && target.classList.contains("bar");

    if (target instanceof HTMLSelectElement || (target instanceof HTMLButtonElement && !isToneBar)) {
      return;
    }

    if (isToneBar && (event.key === "Enter" || event.key === " ")) {
      return;
    }

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const noteIndex = state.notes.findIndex((note) => note.keyboardKey === key);

    if (noteIndex >= 0) {
      event.preventDefault();
      playNoteAtIndex(noteIndex);
    }
  });
}

function init() {
  loadNotationPreference();
  loadDisplayPreferences();
  renderControls();
  bindEvents();
  updateUI();
  updateAudioButton();
}

init();