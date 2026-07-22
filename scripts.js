const RADIO_VERSION = "v4.2.2";
const VERSION_STORAGE_KEY = 'enlightenedRadioLastSeenVersion';

const songsFolder = 'Songs/';
const adsFolder = 'Ads/';
const playsFolder = 'Plays/';
const hostFolder = 'VoiceLines/';
const introFile = 'intro.mp3';

const songs = Array.from({ length: 293 }, (_, i) => `song${i + 1}.mp3`);
const ads = Array.from({ length: 45 }, (_, i) => `ad${i + 1}.mp3`);
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
let lastSongPlayed = '';
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

fetch('song_titles.json')
  .then(res => res.json())
  .then(data => songTitles = data);

let adTitles = { ads: {}, plays: {} };
fetch('ad_titles.json')
  .then(res => res.json())
  .then(data => adTitles = data);

const audioElement = document.getElementById('audio-player');
const volumeSlider = document.getElementById('volumeSlider');

const savedVolume = localStorage.getItem('radioVolume');
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
  localStorage.setItem('radioVolume', volume);
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
  audioElement._watchdogFired = false;
  if (radioOn && !isAdvancing) {
    isAdvancing = true;
    playFromQueue();
  }
});

setInterval(() => {
  if (!radioOn || isAdvancing) return;

  if (audioElement.paused) {
    if (audioElement.src && audioElement.readyState >= 2) {
      audioElement.play().catch(() => {});
    } else if (audioElement.src && audioElement.readyState < 2) {
      isAdvancing = true;
      playFromQueue();
    }
    return;
  }

  if (audioElement.duration && audioElement.duration > 0) {
    const remaining = audioElement.duration - audioElement.currentTime;
    if (remaining < 0.8 && remaining > 0) {
      audioElement._watchdogFired = true;
    } else if (remaining <= 0 || (audioElement._watchdogFired && audioElement.paused)) {
      audioElement._watchdogFired = false;
      isAdvancing = true;
      playFromQueue();
    }
  }
}, 750);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
    if (radioOn && audioElement.paused && audioElement.src) {
      audioElement.play().catch(() => { });
    }
  }
});

function getRandomItem(array) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

let mediaQueue = [];

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
  if (isFalloutMode()) {
    const info = songTitles[song];
    const genres = info && info.genre ? info.genre.split(',').map(g => g.trim().toLowerCase()) : [];
    if (!genres.includes('fallout')) return false;
  }
  return true;
}

function isImmersiveMode() {
  const immersive = document.getElementById('immersiveMode');
  return immersive && immersive.checked;
}

function isFalloutMode() {
  const fallout = document.getElementById('falloutMode');
  return fallout && fallout.checked;
}

function isAdFreeMode() {
  const adFree = document.getElementById('adFreeMode');
  return adFree && adFree.checked;
}

function isFamilyFriendlyMode() {
  const familyFriendly = document.getElementById('familyFriendlyMode');
  return familyFriendly && familyFriendly.checked;
}

function getFilteredList(list, type) {
  const familyFriendly = isFamilyFriendlyMode();

  let filtered = list;

  if (familyFriendly && type === 'song') {
    filtered = filtered.filter(item => {
      const info = songTitles[item];
      const genres = info && info.genre ? info.genre.split(',').map(g => g.trim().toLowerCase()) : [];
      return !genres.includes('nsfw');
    });
  }

  return filtered;
}

function fillQueue() {
  while (mediaQueue.length < 6) {
    if (currentSongCount < 2) {
      let unplayedSongs = getFilteredList(songs.filter(song => !playedSongs.includes(song)), 'song');
      if (unplayedSongs.length === 0) {
        playedSongs = [];
        unplayedSongs = getFilteredList([...songs], 'song');
      }
      if (unplayedSongs.length === 0) break;

      let nextSong = getRandomItem(unplayedSongs);
      lastSongPlayed = nextSong;
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
          let adList = ads;
          if (adList.length > 0) {
            nextSource = getRandomItem(adList);
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

  mediaQueue.forEach(item => {
    if (!item.preloader) {
      item.preloader = new Audio();
      item.preloader.preload = 'auto';
      item.preloader.src = item.url;
    }
  });
}

function playFromQueue() {
  if (!radioOn) return;
  fillQueue();

  if (mediaQueue.length === 0) {
    isAdvancing = false;
    setTimeout(playFromQueue, 1000);
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

  updateNowPlaying(nextItem.displayTitle);
  updateMediaSession(nextItem.mediaTitle, nextItem.mediaArtist);

  audioElement.src = nextItem.url;

  if (nextItem.type === 'voice' || nextItem.type === 'intro') {
    if (bandpass) bandpass.disconnect();
    if (distortion) distortion.disconnect();
    if (musicGain) musicGain.disconnect();
    if (voiceDistortion) voiceDistortion.disconnect();
    if (voiceGain) voiceGain.disconnect();
    if (voiceDistortion && voiceGain) voiceDistortion.connect(voiceGain);
    if (voiceGain) voiceGain.connect(audioContext.destination);
  } else {
    if (voiceDistortion) voiceDistortion.disconnect();
    if (voiceGain) voiceGain.disconnect();
    if (bandpass) bandpass.connect(distortion);
    if (distortion) distortion.connect(musicGain);
    if (musicGain) musicGain.connect(audioContext.destination);
  }

  if (startPlaybackHandler) {
    audioElement.removeEventListener('canplay', startPlaybackHandler);
  }

  startPlaybackHandler = () => {
    audioElement.removeEventListener('canplay', startPlaybackHandler);
    if (stallTimeout) clearTimeout(stallTimeout);
    isAdvancing = false;

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

  stallTimeout = setTimeout(() => {
    audioElement.removeEventListener('canplay', startPlaybackHandler);
    if (radioOn) {
      console.warn('Track stalled on load, skipping:', nextItem.url);
      playFromQueue();
    }
  }, 3000);

  audioElement.addEventListener('canplay', startPlaybackHandler);

  if (audioElement.readyState >= 2) {
    startPlaybackHandler();
  }
}

function playIntroduction() {
  const immersiveMode = document.getElementById('immersiveMode');
  if (!radioOn) return;
  if (immersiveMode && immersiveMode.checked) {
    playFromQueue();
    return;
  }
  updateNowPlaying('Welcome to Enlightened Radio');
  updateMediaSession('Welcome to Enlightened Radio', "Host");
  audioElement.src = introFile;
  if (bandpass) bandpass.disconnect();
  if (distortion) distortion.disconnect();
  if (musicGain) musicGain.disconnect();
  if (voiceDistortion) voiceDistortion.disconnect();
  if (voiceGain) voiceGain.disconnect();
  if (voiceDistortion && voiceGain) voiceDistortion.connect(voiceGain);
  if (voiceGain) voiceGain.connect(audioContext.destination);
  const initHandler = () => {
    audioElement.removeEventListener('canplay', initHandler);
    clearTimeout(initTimeout);
    audioElement.play().catch(() => {});
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
      artwork: [
        { src: 'https://ashhaven.com/images/logo.png', sizes: '512x512', type: 'image/png' }
      ]
    });
  }
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    if (!radioOn) powerOn();
    else if (audioContext) audioContext.resume().then(() => audioElement.play().catch(() => { }));
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
    const volume = parseFloat(volumeSlider.value);
    const baseStatic = 0.001;
    const dynamicStatic = 0.0015;
    if (staticGain) {
      staticGain.gain.value = (baseStatic + dynamicStatic * Math.sqrt(volume)) * (1 - volume * 0.3);
    }
    if (audioElement.paused && audioElement.src) {
      let src = audioElement.src;
      if (src) {
        if (src.includes(songsFolder)) {
          const songFile = src.split('/').pop();
          const songInfo = songTitles[songFile] || {};
          const title = songInfo.title || songFile;
          const artist = songInfo.artist || "Unknown Artist";
          const nowPlaying = `${title}${artist !== "Unknown Artist" ? " by " + artist : ""}`;
          updateNowPlaying(nowPlaying);
          updateMediaSession(title, artist);
        } else if (src.includes(adsFolder)) {
          const adFile = src.split('/').pop();
          const displayTitle = adTitles.ads[adFile] ? adTitles.ads[adFile].title : adFile;
          updateNowPlaying(`${displayTitle}`);
          updateMediaSession(displayTitle, "Enlightened Radio Sponsor");
        } else if (src.includes(playsFolder)) {
          const playFile = src.split('/').pop();
          const displayTitle = adTitles.plays[playFile] ? adTitles.plays[playFile].title : playFile;
          updateNowPlaying(`${displayTitle}`);
          updateMediaSession(displayTitle, "Enlightened Radio");
        } else if (src.includes(hostFolder)) {
          const hostFile = src.split('/').pop();
          updateNowPlaying(`${hostFile}`);
          updateMediaSession(`${hostFile}`, "Host");
        } else if (src.includes(introFile)) {
          updateNowPlaying('Welcome to Enlightened Radio');
          updateMediaSession('Welcome to Enlightened Radio', "Host");
        }
      }
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
    lastSongPlayed: lastSongPlayed,
    currentSeries: currentSeries,
    nextSeriesIndex: nextSeriesIndex,
    currentSrc: audioElement.src,
    currentTime: audioElement.currentTime,
    nowPlayingText: document.getElementById('now-playing').textContent,
    mediaQueue: mediaQueue.map(item => ({ ...item, preloader: null })),
    immersiveMode: document.getElementById('immersiveMode')?.checked || false,
    falloutMode: document.getElementById('falloutMode')?.checked || false,
    adFreeMode: document.getElementById('adFreeMode')?.checked || false,
    familyFriendlyMode: document.getElementById('familyFriendlyMode')?.checked || false
  };
  localStorage.setItem('radioState', JSON.stringify(state));
}

window.addEventListener('beforeunload', saveState);

document.getElementById('immersiveMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('falloutMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('adFreeMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('familyFriendlyMode')?.addEventListener('change', handleModifierToggle);
window.addEventListener('load', loadState);

function loadState() {
  const savedState = localStorage.getItem('radioState');
  if (savedState) {
    const state = JSON.parse(savedState);
    playedSongs = state.playedSongs || [];
    currentSongCount = state.currentSongCount || 0;
    lastSongPlayed = state.lastSongPlayed || '';
    currentSeries = state.currentSeries || null;
    nextSeriesIndex = state.nextSeriesIndex || 0;

    // Filter out invalid media queue items (missing url/type)
    mediaQueue = (state.mediaQueue || []).filter(item => item && item.url && item.type);
    mediaQueue.forEach(item => {
      item.preloader = new Audio();
      item.preloader.preload = 'auto';
      item.preloader.src = item.url;
    });

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

// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js', { scope: './' })
    .catch(err => console.error('SW registration failed:', err));
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
  localStorage.removeItem('radioState');
  localStorage.removeItem('radioVolume');
  markVersionAsSeen(RADIO_VERSION);
  location.reload();
}

function checkVersion() {
  fetch('version.json', { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      const remoteVersion = data.version;
      if (!remoteVersion) return;

      const lastSeenVersion = localStorage.getItem(VERSION_STORAGE_KEY);

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