const RADIO_VERSION = "v4.5";
const VERSION_STORAGE_KEY = 'enlightenedRadioLastSeenVersion';

const songsFolder = 'Songs/';
const adsFolder = 'Extras/';
const playsFolder = 'Plays/';
const hostFolder = 'VoiceLines/';
const introFile = 'intro.mp3';

const songs = Array.from({ length: 293 }, (_, i) => `song${i + 1}.mp3`);
const ads = Array.from({ length: 45 }, (_, i) => `extra${i + 1}.mp3`);
const plays = Array.from({ length: 41 }, (_, i) => `play${i + 1}.mp3`);

const preVoiceLines = {
  'song25.mp3': ['voice4.mp3'],
  'song53.mp3': ['voice5.mp3'],
  'song240.mp3': ['voice6.mp3'],
  'song215.mp3': ['voice7.mp3'],
  'song21.mp3': ['voice9.mp3'],
  'song180.mp3': ['voice10.mp3'],
};

const postVoiceLines = {
  'song116.mp3': ['voice1.mp3'],
  'song179.mp3': ['voice2.mp3'],
  'song105.mp3': ['voice3.mp3'],
  'song235.mp3': ['voice8.mp3'],
  'song44.mp3': ['voice11.mp3'],
};

let radioOn = false;
let isAdvancing = false;
let currentSongCount = 0;
let playedSongs = [];
let songTitles = {};

const playSeries = [
  ['play1.mp3', 'play2.mp3'],
  ['play3.mp3', 'play4.mp3'],
  ['play5.mp3', 'play6.mp3'],
  ['play7.mp3', 'play8.mp3'],
  ['play9.mp3', 'play10.mp3'],
  ['play11.mp3', 'play12.mp3', 'play13.mp3', 'play14.mp3', 'play15.mp3', 'play16.mp3'],
  ['play17.mp3', 'play18.mp3', 'play19.mp3', 'play20.mp3'],
  ['play21.mp3', 'play22.mp3', 'play23.mp3', 'play24.mp3', 'play25.mp3'],
  ['play27.mp3', 'play26.mp3', 'play28.mp3', 'play29.mp3'],
  ['play30.mp3', 'play31.mp3', 'play32.mp3', 'play33.mp3', 'play34.mp3'],
  ['play35.mp3', 'play36.mp3', 'play37.mp3', 'play38.mp3', 'play39.mp3', 'play40.mp3', 'play41.mp3'],
];

let currentSeries = null;
let nextSeriesIndex = 0;

let startPlaybackHandler = null;
let stallTimeout = null;
let stallProgressHandler = null;
let loadCounter = 0;
let notReadyTicks = 0;
let stateLoadResult = null;

const PRELOAD_AHEAD = 2;      // only buffer the next couple of tracks so they don't fight the current one
const STALL_TIMEOUT_MS = 15000; // skip only if no data has arrived for this long
const TRACK_GAP_MS = 1000;      // pause between tracks so slow connections/devices can load the next one
let trackGapTimeout = null;

// Called when a track finishes: wait briefly, then start the next one
function advanceAfterGap() {
  isAdvancing = true;
  if (trackGapTimeout) clearTimeout(trackGapTimeout);
  trackGapTimeout = setTimeout(() => {
    trackGapTimeout = null;
    playFromQueue();
  }, TRACK_GAP_MS);
}

function clearStallTimer() {
  if (stallTimeout) {
    clearTimeout(stallTimeout);
    stallTimeout = null;
  }
  if (stallProgressHandler) {
    audioElement.removeEventListener('progress', stallProgressHandler);
    stallProgressHandler = null;
  }
}

let adTitles = { ads: {}, plays: {} };
let titlesLoaded = false;
Promise.all([
  fetch('song_titles.json').then(res => res.json()).then(data => songTitles = data),
  fetch('extra_titles.json').then(res => res.json()).then(data => adTitles = data),
])
  .catch(e => console.warn('Could not load titles:', e))
  .finally(() => titlesLoaded = true);

const audioElement = document.getElementById('audio-player');
const volumeSlider = document.getElementById('volumeSlider');

let savedVolume = null;
try { savedVolume = localStorage.getItem('radioVolume'); } catch (e) {}
if (savedVolume !== null) {
  volumeSlider.value = savedVolume;
}

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;

function getAudioContext() {
    if (!audioContext) {
        audioContext = new AudioContextClass();
    }
    return audioContext;
}

let sourceNode = null;
let bandpass = null;
let distortion = null;
let musicGain = null;
let staticGain = null;
let voiceDistortion = null;
let voiceGain = null;

volumeSlider.addEventListener('input', () => {
  const volume = parseFloat(volumeSlider.value);
  if (musicGain) musicGain.gain.value = volume;
  if (voiceGain) voiceGain.gain.value = volume;
  if (radioOn && staticGain) {
    const baseStatic = 0.001;
    const dynamicStatic = 0.0015;
    staticGain.gain.value = (baseStatic + dynamicStatic * Math.sqrt(volume)) * (1 - volume * 0.3);
  }
  try { localStorage.setItem('radioVolume', volume); } catch (e) {}
});

window.addEventListener('click', () => {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
});

audioElement.addEventListener('play', () => {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
});

audioElement.addEventListener('ended', () => {
  if (radioOn && !isAdvancing) {
    advanceAfterGap();
  }
});

audioElement.addEventListener('error', () => {
  if (!radioOn || !audioElement.getAttribute('src')) return;
  console.warn('Track failed to load, skipping:', audioElement.src);
  clearStallTimer();
  isAdvancing = true;
  playFromQueue();
});

setInterval(() => {
  if (!radioOn || isAdvancing) return;

  if (audioElement.paused) {
    if (!audioElement.src) return;
    if (audioElement.readyState >= 2) {
      notReadyTicks = 0;
      audioElement.play().catch(() => {});
    } else if (++notReadyTicks * 750 >= STALL_TIMEOUT_MS) {
      // Still loading after a long time: give up on this track
      notReadyTicks = 0;
      isAdvancing = true;
      playFromQueue();
    } else {
      // Still buffering — make sure it starts as soon as it can
      audioElement.play().catch(() => {});
    }
    return;
  }
  notReadyTicks = 0;

  // Backup for a missed 'ended' event
  if (audioElement.duration > 0 && audioElement.currentTime >= audioElement.duration) {
    advanceAfterGap();
  }
}, 750);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (radioOn && !isAdvancing && audioElement.paused && audioElement.src) {
      audioElement.play().catch(() => { });
    }
  }
});

function getRandomItem(array) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

let mediaQueue = [];
let currentItem = null; // the track loaded in the player, saved so power-on/reload can show it again

const isVoiceItem = item => item.type === 'voice' || item.type === 'intro';

// Send audio through the voice chain or the music chain, never both
function routeAudio(isVoice) {
  if (!sourceNode) return;
  [bandpass, distortion, musicGain, voiceDistortion, voiceGain].forEach(node => node.disconnect());
  if (isVoice) {
    voiceDistortion.connect(voiceGain);
    voiceGain.connect(audioContext.destination);
  } else {
    bandpass.connect(distortion);
    distortion.connect(musicGain);
    musicGain.connect(audioContext.destination);
  }
}

function showItem(item) {
  updateNowPlaying(item.displayTitle);
  updateMediaSession(item.mediaTitle, item.mediaArtist);
}

function clearQueue() {
  mediaQueue.forEach(item => {
    if (item.preloader) item.preloader.src = '';
  });
  mediaQueue = [];
}

function handleModifierToggle() {
  saveState();
  if (radioOn) {
    clearQueue();
    fillQueue();
  }
}

function shouldPlayVoiceLine(song) {
  if (isImmersiveMode()) return false;
  if (isFalloutMode() && !getGenres(song).includes('fallout')) return false;
  return true;
}

const isChecked = id => !!document.getElementById(id)?.checked;
const isImmersiveMode = () => isChecked('immersiveMode');
const isFalloutMode = () => isChecked('falloutMode');
const isAdFreeMode = () => isChecked('adFreeMode');
const isFamilyFriendlyMode = () => isChecked('familyFriendlyMode');

function getGenres(song) {
  const info = songTitles[song];
  return info && info.genre ? info.genre.split(',').map(g => g.trim().toLowerCase()) : [];
}

function getFilteredList(list, type) {
  if (type !== 'song') return list;
  const familyFriendly = isFamilyFriendlyMode();
  const falloutOnly = isFalloutMode();
  return list.filter(song => {
    const genres = getGenres(song);
    if (familyFriendly && genres.includes('nsfw')) return false;
    if (falloutOnly && !genres.includes('fallout')) return false;
    return true;
  });
}

function fillQueue() {
  // Filters need the genre tags; playFromQueue retries until they arrive
  if (!titlesLoaded) return;
  while (mediaQueue.length < 6) {
    if (currentSongCount < 2) {
      let unplayedSongs = getFilteredList(songs.filter(song => !playedSongs.includes(song)), 'song');
      if (unplayedSongs.length === 0) {
        playedSongs = [];
        unplayedSongs = getFilteredList([...songs], 'song');
      }
      if (unplayedSongs.length === 0) break;

      let nextSong = getRandomItem(unplayedSongs);
      playedSongs.push(nextSong);
      currentSongCount++;

      const displayTitle = songTitles[nextSong] ? songTitles[nextSong].title : nextSong;
      const songInfo = songTitles[nextSong] || {};
      const title = songInfo.title || displayTitle;
      const artist = songInfo.artist || "Unknown Artist";

      if (shouldPlayVoiceLine(nextSong)) {
        let preLines = preVoiceLines[nextSong] || [];
        if (preLines.length > 0) {
          let line = getRandomItem(preLines);
          mediaQueue.push({
            url: hostFolder + line,
            type: 'voice',
            displayTitle: `${line}`,
            mediaTitle: `${line}`,
            mediaArtist: 'Host',
            originalFile: line
          });
        }
      }

      mediaQueue.push({
        url: songsFolder + nextSong,
        type: 'song',
        displayTitle: `${title}${artist !== "Unknown Artist" ? " by " + artist : ""}`,
        mediaTitle: title,
        mediaArtist: artist,
        originalFile: nextSong
      });

      if (shouldPlayVoiceLine(nextSong)) {
        let postLines = postVoiceLines[nextSong] || [];
        if (postLines.length > 0) {
          let line = getRandomItem(postLines);
          mediaQueue.push({
            url: hostFolder + line,
            type: 'voice',
            displayTitle: `${line}`,
            mediaTitle: `${line}`,
            mediaArtist: 'Host',
            originalFile: line
          });
        }
      }
    } else {
      if (isAdFreeMode()) {
        currentSongCount = 0;
        continue;
      }

      let nextSource = null;
      let type = '';
      let dTitle = '';

      if (currentSeries === null) {
        if (Math.random() < 0.2) {
          currentSeries = getRandomItem(playSeries);
          nextSeriesIndex = 0;
          nextSource = currentSeries[nextSeriesIndex];
          nextSeriesIndex++;
          type = 'play';
        } else {
          if (ads.length > 0) {
            nextSource = getRandomItem(ads);
            type = 'ad';
          }
        }
      } else {
        nextSource = currentSeries[nextSeriesIndex];
        nextSeriesIndex++;
        type = 'play';
        if (nextSeriesIndex >= currentSeries.length) {
          currentSeries = null;
          nextSeriesIndex = 0;
        }
      }

      if (!nextSource) {
        currentSongCount = 0;
        continue;
      }

      if (type === 'play') {
        dTitle = adTitles.plays[nextSource] ? adTitles.plays[nextSource].title : nextSource;
        mediaQueue.push({
          url: playsFolder + nextSource,
          type: 'play',
          displayTitle: `${dTitle}`,
          mediaTitle: dTitle,
          mediaArtist: "Enlightened Radio",
          originalFile: nextSource
        });
      } else if (type === 'ad') {
        dTitle = adTitles.ads[nextSource] ? adTitles.ads[nextSource].title : nextSource;
        mediaQueue.push({
          url: adsFolder + nextSource,
          type: 'ad',
          displayTitle: `${dTitle}`,
          mediaTitle: dTitle,
          mediaArtist: "Enlightened Radio Sponsor",
          originalFile: nextSource
        });
      }
      currentSongCount = 0;
    }
  }

  preloadQueue();
}

function preloadQueue() {
  mediaQueue.forEach((item, i) => {
    if (i < PRELOAD_AHEAD && !item.preloader) {
      item.preloader = new Audio();
      item.preloader.preload = 'auto';
      item.preloader.src = item.url;
    }
  });
}

function playFromQueue() {
  if (!radioOn) return;
  clearTimeout(trackGapTimeout);
  trackGapTimeout = null;
  clearStallTimer();
  notReadyTicks = 0;
  fillQueue();

  if (mediaQueue.length === 0) {
    isAdvancing = true; // stops the watchdog replaying the finished track while we wait
    trackGapTimeout = setTimeout(playFromQueue, 1000); // shared timer so only one retry loop exists
    return;
  }

  const nextItem = mediaQueue.shift();

  // Validate item has required properties
  if (!nextItem || !nextItem.url || !nextItem.type) {
    console.warn('Invalid media queue item, skipping:', nextItem);
    isAdvancing = false;
    playFromQueue();
    return;
  }

  if (nextItem.preloader) {
    nextItem.preloader.src = '';
    nextItem.preloader = null;
  }

  fillQueue();

  currentItem = nextItem;
  showItem(nextItem);
  audioElement.src = nextItem.url;
  routeAudio(isVoiceItem(nextItem));

  if (startPlaybackHandler) {
    audioElement.removeEventListener('canplay', startPlaybackHandler);
  }

  const loadToken = ++loadCounter;

  startPlaybackHandler = () => {
    audioElement.removeEventListener('canplay', startPlaybackHandler);
    clearStallTimer();
    isAdvancing = false;
    if (!radioOn) return;

    audioElement.play().catch(e => {
      console.error("Playback failed:", e);
      setTimeout(() => {
        if (radioOn && audioContext) {
          audioContext.resume().then(() => {
            audioElement.play().catch(() => {
              isAdvancing = true;
              playFromQueue();
            });
          });
        }
      }, 500);
    });
  };

  // Skip only if the track stops receiving data, not just because it's slow to buffer
  const armStallTimer = () => {
    if (stallTimeout) clearTimeout(stallTimeout);
    stallTimeout = setTimeout(() => {
      if (loadToken !== loadCounter || !radioOn) return;
      audioElement.removeEventListener('canplay', startPlaybackHandler);
      console.warn('Track stalled on load, skipping:', nextItem.url);
      playFromQueue();
    }, STALL_TIMEOUT_MS);
  };
  stallProgressHandler = armStallTimer;
  audioElement.addEventListener('progress', stallProgressHandler);
  armStallTimer();

  audioElement.addEventListener('canplay', startPlaybackHandler);

  if (audioElement.readyState >= 2) {
    startPlaybackHandler();
  }
}

function playIntroduction() {
  if (!radioOn) return;
  if (isImmersiveMode()) {
    playFromQueue();
    return;
  }
  currentItem = {
    url: introFile,
    type: 'intro',
    displayTitle: 'Welcome to Enlightened Radio',
    mediaTitle: 'Welcome to Enlightened Radio',
    mediaArtist: 'Host'
  };
  showItem(currentItem);
  audioElement.src = introFile;
  routeAudio(true);
  const initHandler = () => {
    audioElement.removeEventListener('canplay', initHandler);
    clearTimeout(initTimeout);
    if (radioOn) audioElement.play().catch(() => {});
  };

  const initTimeout = setTimeout(() => {
    audioElement.removeEventListener('canplay', initHandler);
    if (radioOn) fillQueue();
  }, 3000);

  audioElement.addEventListener('canplay', initHandler);
  if (audioElement.readyState >= 2) initHandler();

  fillQueue();
}

function updateNowPlaying(text) {
  const nowPlayingDisplay = document.getElementById('now-playing');
  if (nowPlayingDisplay) {
    nowPlayingDisplay.textContent = text;
  }
}

function updateMediaSession(title, artist) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: artist,
      album: 'Enlightened Radio',
    });
  }
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    if (!radioOn) powerOn();
    else if (audioContext && !isAdvancing) audioContext.resume().then(() => audioElement.play().catch(() => { }));
  });
  navigator.mediaSession.setActionHandler('pause', () => powerOff());
  navigator.mediaSession.setActionHandler('stop', () => powerOff());
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if (radioOn) {
      isAdvancing = true;
      playFromQueue();
    }
  });
}

function makeDistortionCurve(amount) {
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = i * 2 / n_samples - 1;
    curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function createWhiteNoise(context) {
  const bufferSize = 2 * context.sampleRate;
  const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  const whiteNoise = context.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;
  return whiteNoise;
}

let initialized = false;

function initializeRadio() {
  if (!initialized) {
    initialized = true;
    const stateLoaded = loadState();
    if (stateLoaded && audioElement.src) {
    } else {
      playIntroduction();
    }
  }
}

function powerOn() {
  if (radioOn) return;
  radioOn = true;

  const ctx = getAudioContext();
  
  if (!sourceNode) {
    sourceNode = ctx.createMediaElementSource(audioElement);
    bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1000;
    bandpass.Q.value = 1;

    distortion = ctx.createWaveShaper();
    distortion.curve = makeDistortionCurve(100);
    distortion.oversample = '4x';

    musicGain = ctx.createGain();
    musicGain.gain.value = parseFloat(volumeSlider.value);

    staticGain = ctx.createGain();
    staticGain.gain.value = 0;

    const staticNoise = createWhiteNoise(ctx);
    staticNoise.connect(staticGain);
    staticGain.connect(ctx.destination);
    staticNoise.start();

    voiceDistortion = ctx.createWaveShaper();
    voiceDistortion.curve = makeDistortionCurve(25);
    voiceDistortion.oversample = 'none';

    voiceGain = ctx.createGain();
    voiceGain.gain.value = parseFloat(volumeSlider.value);

    const splitter = ctx.createGain();
    sourceNode.connect(splitter);

    splitter.connect(bandpass);
    bandpass.connect(distortion);
    distortion.connect(musicGain);
    musicGain.connect(ctx.destination);

    splitter.connect(voiceDistortion);
    voiceDistortion.connect(voiceGain);
    voiceGain.connect(ctx.destination);
  }

  ctx.resume().then(() => {
    if (!radioOn) return; // powered off again before audio woke up
    const volume = parseFloat(volumeSlider.value);
    const baseStatic = 0.001;
    const dynamicStatic = 0.0015;
    if (staticGain) {
      staticGain.gain.value = (baseStatic + dynamicStatic * Math.sqrt(volume)) * (1 - volume * 0.3);
    }
    if (audioElement.ended) {
      // Powered off during the gap between tracks: move on instead of replaying
      isAdvancing = true;
      playFromQueue();
    } else if (audioElement.paused && audioElement.src) {
      // Resuming a paused or restored track: show its title and route it to the right chain
      if (currentItem) showItem(currentItem);
      routeAudio(currentItem ? isVoiceItem(currentItem) : false);
      audioElement.play().catch(() => { });
    }
    if (!initialized) {
      setTimeout(() => {
        if (radioOn && !initialized) initializeRadio();
      }, 100);
    }
    const powerLed = document.getElementById('power-led');
    if (powerLed) {
      powerLed.style.background = '#c77dff';
      powerLed.style.boxShadow = '0 0 12px #c77dff, 0 0 20px #c77dff';
    }
    const powerButton = document.getElementById('powerButton');
    if (powerButton) {
      powerButton.textContent = '⏻';
      powerButton.style.background = '#240046';
      powerButton.style.color = '#e0aaff';
      powerButton.style.borderColor = '#9d4edd';
      powerButton.style.boxShadow = '0 0 15px rgba(157, 78, 221, 0.8), inset 0 0 8px rgba(157, 78, 221, 0.4)';
      powerButton.title = 'Power';
    }
  });
}

function powerOff() {
  updateNowPlaying('');
  radioOn = false;
  isAdvancing = false;
  clearStallTimer();
  if (trackGapTimeout) {
    clearTimeout(trackGapTimeout);
    trackGapTimeout = null;
  }
  if (staticGain) staticGain.gain.value = 0;
  audioElement.pause();
  const powerLed = document.getElementById('power-led');
  if (powerLed) {
    powerLed.style.background = '#222222';
    powerLed.style.boxShadow = '0 0 8px #000';
  }
  const powerButton = document.getElementById('powerButton');
  if (powerButton) {
    powerButton.textContent = '⏻';
    powerButton.style.background = '#111111';
    powerButton.style.color = '#7b2cbf';
    powerButton.style.borderColor = '#3c096c';
    powerButton.style.boxShadow = '0 0 10px rgba(123, 44, 191, 0.3)';
    powerButton.title = 'Power';
  }
}

function toggleRadio() {
  if (radioOn) {
    powerOff();
  } else {
    powerOn();
  }
}

let isResetting = false;

function saveState() {
  if (isResetting) return;
  const state = {
    playedSongs: playedSongs,
    currentSongCount: currentSongCount,
    currentSeries: currentSeries,
    nextSeriesIndex: nextSeriesIndex,
    currentSrc: audioElement.src,
    currentTime: audioElement.currentTime,
    nowPlayingText: document.getElementById('now-playing').textContent,
    mediaQueue: mediaQueue.map(item => ({ ...item, preloader: null })),
    currentItem: currentItem && { ...currentItem, preloader: null },
    immersiveMode: document.getElementById('immersiveMode')?.checked || false,
    falloutMode: document.getElementById('falloutMode')?.checked || false,
    adFreeMode: document.getElementById('adFreeMode')?.checked || false,
    familyFriendlyMode: document.getElementById('familyFriendlyMode')?.checked || false
  };
  try { localStorage.setItem('radioState', JSON.stringify(state)); } catch (e) {}
}

window.addEventListener('beforeunload', saveState);
window.addEventListener('pagehide', saveState); // mobile browsers often skip beforeunload

document.getElementById('immersiveMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('falloutMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('adFreeMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('familyFriendlyMode')?.addEventListener('change', handleModifierToggle);
window.addEventListener('load', loadState);

function loadState() {
  // Runs on page load and again on first power-on; only restore once
  if (stateLoadResult !== null) return stateLoadResult;
  stateLoadResult = restoreState();
  return stateLoadResult;
}

function restoreState() {
  let state = null;
  try {
    state = JSON.parse(localStorage.getItem('radioState'));
  } catch (e) {
    console.warn('Saved radio state unreadable, starting fresh:', e);
  }
  if (state && typeof state === 'object') {
    playedSongs = state.playedSongs || [];
    currentSongCount = state.currentSongCount || 0;
    currentSeries = state.currentSeries || null;
    nextSeriesIndex = state.nextSeriesIndex || 0;

    // Filter out invalid media queue items (missing url/type)
    clearQueue();
    mediaQueue = (state.mediaQueue || []).filter(item => item && item.url && item.type);
    preloadQueue();

    currentItem = state.currentItem || null;
    if (state.currentSrc) {
      audioElement.src = state.currentSrc;
      audioElement.currentTime = state.currentTime || 0;
    }
    if (state.nowPlayingText) {
      updateNowPlaying(state.nowPlayingText);
    }

    const immersiveCheckbox = document.getElementById('immersiveMode');
    if (immersiveCheckbox) immersiveCheckbox.checked = state.immersiveMode || false;

    const falloutCheckbox = document.getElementById('falloutMode');
    if (falloutCheckbox) falloutCheckbox.checked = state.falloutMode || false;

    const adFreeCheckbox = document.getElementById('adFreeMode');
    if (adFreeCheckbox) adFreeCheckbox.checked = state.adFreeMode || false;

    const familyFriendlyCheckbox = document.getElementById('familyFriendlyMode');
    if (familyFriendlyCheckbox) familyFriendlyCheckbox.checked = state.familyFriendlyMode || false;

    return true;
  }
  return false;
}

function markVersionAsSeen(version) {
  try {
    localStorage.setItem(VERSION_STORAGE_KEY, version);
  } catch (error) {
    console.warn('Could not save version state:', error);
  }
}

function resetRadio() {
  isResetting = true;
  try {
    localStorage.removeItem('radioState');
    localStorage.removeItem('radioVolume');
  } catch (e) {}
  markVersionAsSeen(RADIO_VERSION);
  location.reload();
}

function checkVersion() {
  fetch('version.json', { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      const remoteVersion = data.version;
      if (!remoteVersion) return;

      let lastSeenVersion = null;
      try { lastSeenVersion = localStorage.getItem(VERSION_STORAGE_KEY); } catch (e) {}

      if (remoteVersion !== RADIO_VERSION) {
        if (lastSeenVersion !== remoteVersion) {
          document.getElementById('updateModal')?.classList.add('show');
          markVersionAsSeen(remoteVersion);
        }
      } else {
        markVersionAsSeen(remoteVersion);
      }
    })
    .catch(() => { });
}

const filtersBtn = document.getElementById('filtersBtn');
const filtersContent = document.getElementById('filtersContent');

if (filtersBtn && filtersContent) {
  filtersBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    filtersContent.classList.toggle('show');
  });

  window.addEventListener('click', (e) => {
    if (!filtersBtn.contains(e.target) && !filtersContent.contains(e.target)) {
      filtersContent.classList.remove('show');
    }
  });
}