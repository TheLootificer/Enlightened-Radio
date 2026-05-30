const songsFolder = 'Songs/';
const adsFolder = 'Ads/';
const playsFolder = 'Plays/';
const hostFolder = 'VoiceLines/';
const introFile = 'intro.mp3';

const songs = Array.from({ length: 268 }, (_, i) => `song${i + 1}.mp3`);
const ads = Array.from({ length: 44 }, (_, i) => `ad${i + 1}.mp3`);
const plays = Array.from({ length: 41 }, (_, i) => `play${i + 1}.mp3`);

const preVoiceLines = {
  'song26.mp3': ['voice4.mp3'],
  'song54.mp3': ['voice5.mp3'],
  'song233.mp3': ['voice6.mp3'],
};

const postVoiceLines = {
  'song106.mp3': ['voice3.mp3'],
  'song118.mp3': ['voice1.mp3'],
  'song177.mp3': ['voice2.mp3'],
};

let radioOn = false;
let isAdvancing = false;
let currentSongCount = 0;
let lastSongPlayed = '';
let playedSongs = [];
let songTitles = {};

const playSeries = [
  ['play1.mp3', 'play2.mp3'], // Curse of the Wendigo
  ['play3.mp3', 'play4.mp3'], // The Beast of Grafton
  ['play5.mp3', 'play6.mp3'], // Who Goes There?
  ['play7.mp3', 'play8.mp3'], // Sideshow Snallygaster
  ['play9.mp3', 'play10.mp3'], // The Mothman Cometh
  ['play11.mp3', 'play12.mp3', 'play13.mp3', 'play14.mp3', 'play15.mp3', 'play16.mp3'], // Heart of Steel
  ['play17.mp3', 'play18.mp3', 'play19.mp3', 'play20.mp3'], // Escape from the 42nd Century
  ['play21.mp3', 'play22.mp3', 'play23.mp3', 'play24.mp3', 'play25.mp3'], // Nuka World Radio Show
  ['play27.mp3', 'play26.mp3', 'play28.mp3', 'play29.mp3'], // Astounding Awesome Tales
  ['play30.mp3', 'play31.mp3', 'play32.mp3', 'play33.mp3', 'play34.mp3'], // A Better Life Underground
  ['play35.mp3', 'play36.mp3', 'play37.mp3', 'play38.mp3', 'play39.mp3', 'play40.mp3', 'play41.mp3'], // Zorbo's Revenge
];

let currentSeries = null;
let nextSeriesIndex = 0;

fetch('song_titles.json')
  .then(res => res.json())
  .then(data => songTitles = data);

let adTitles = { ads: {}, plays: {} };
fetch('ad_titles.json')
  .then(res => res.json())
  .then(data => adTitles = data);

const audioElement = document.getElementById('audio-player');
const volumeSlider = document.getElementById('volumeSlider');

// Restore saved volume
const savedVolume = localStorage.getItem('radioVolume');
if (savedVolume !== null) {
  volumeSlider.value = savedVolume;
}
const nowPlayingDisplay = document.getElementById('now-playing');

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audioContext = new AudioContextClass();

const sourceNode = audioContext.createMediaElementSource(audioElement);
const bandpass = audioContext.createBiquadFilter();
bandpass.type = 'bandpass';
bandpass.frequency.value = 1000;
bandpass.Q.value = 1;

const distortion = audioContext.createWaveShaper();
distortion.curve = makeDistortionCurve(100);
distortion.oversample = '4x';

const musicGain = audioContext.createGain();
musicGain.gain.value = parseFloat(volumeSlider.value);

const staticGain = audioContext.createGain();
staticGain.gain.value = 0; // Starts off

const staticNoise = createWhiteNoise(audioContext);
staticNoise.connect(staticGain);
staticGain.connect(audioContext.destination);
staticNoise.start();

const voiceDistortion = audioContext.createWaveShaper();
voiceDistortion.curve = makeDistortionCurve(25);
voiceDistortion.oversample = 'none';

const voiceGain = audioContext.createGain();
voiceGain.gain.value = parseFloat(volumeSlider.value);

const splitter = audioContext.createGain();
sourceNode.connect(splitter);

splitter.connect(bandpass);
bandpass.connect(distortion);
distortion.connect(musicGain);
musicGain.connect(audioContext.destination);

splitter.connect(voiceDistortion);
voiceDistortion.connect(voiceGain);
voiceGain.connect(audioContext.destination);

volumeSlider.addEventListener('input', () => {
  const volume = parseFloat(volumeSlider.value);
  musicGain.gain.value = volume;
  voiceGain.gain.value = volume;
  if (radioOn) {
    const baseStatic = 0.001;
    const dynamicStatic = 0.0015;
    staticGain.gain.value = (baseStatic + dynamicStatic * Math.sqrt(volume)) * (1 - volume * 0.3);
  }
  localStorage.setItem('radioVolume', volume);
});

// Removed stray isHost reference

window.addEventListener('click', () => {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
});

audioElement.addEventListener('play', () => {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
});

// Set ended handler ONCE, permanently
audioElement.addEventListener('ended', () => {
  if (radioOn && !isAdvancing) {
    isAdvancing = true;
    playFromQueue();
  }
});

// Watchdog: catches missed 'ended' events when screen is off
setInterval(() => {
  if (!radioOn || audioElement.paused || isAdvancing) return;
  if (audioElement.duration && audioElement.duration > 0) {
    const remaining = audioElement.duration - audioElement.currentTime;
    if (remaining < 0.8 && remaining > 0) {
      // Nearly done — nudge it along
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
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    // If we should be playing but aren't, recover
    if (radioOn && audioElement.paused && audioElement.src) {
      audioElement.play().catch(() => {});
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
    // Fill it immediately so next track evaluates new criteria
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

// Example filter for Fallout Mode (songs, ads, plays)
function getFilteredList(list, type) {
  const falloutMode = document.getElementById('falloutMode');
  const familyFriendly = isFamilyFriendlyMode();

  let filtered = list;

  if (familyFriendly && type === 'song') {
    filtered = filtered.filter(item => {
      const info = songTitles[item];
      const genres = info && info.genre ? info.genre.split(',').map(g => g.trim().toLowerCase()) : [];
      return !genres.includes('nsfw');
    });
  }

  if (falloutMode && falloutMode.checked) {
    if (type === 'song') {
      // Only Fallout genre songs
      filtered = filtered.filter(item => {
        const info = songTitles[item];
        const genres = info && info.genre ? info.genre.split(',').map(g => g.trim().toLowerCase()) : [];
        return genres.includes('fallout');
      });
    }
    // Fallout mode does NOT filter ads or plays anymore
  }
  return filtered;
}

// Pre-generate logic for continuous buffering
function fillQueue() {
  while (mediaQueue.length < 2) {
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
      let title = displayTitle, artist = "Unknown Artist";
      const lastByIndex = displayTitle.lastIndexOf(" by ");
      if (lastByIndex !== -1) {
        title = displayTitle.substring(0, lastByIndex);
        artist = displayTitle.substring(lastByIndex + 4);
      }
      
      if (shouldPlayVoiceLine(nextSong)) {
        let preLines = preVoiceLines[nextSong] || [];
        if (preLines.length > 0) {
          let line = getRandomItem(preLines);
          mediaQueue.push({
            url: hostFolder + line,
            type: 'voice',
            displayTitle: `Host: ${line}`,
            mediaTitle: `Host: ${line}`,
            mediaArtist: 'Host',
            originalFile: line
          });
        }
      }
      
      mediaQueue.push({
        url: songsFolder + nextSong,
        type: 'song',
        displayTitle: `Now Playing: ${displayTitle}`,
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
            displayTitle: `Host: ${line}`,
            mediaTitle: `Host: ${line}`,
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
          let adList = getFilteredList(ads, 'ad');
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
          displayTitle: `Radio Play: ${dTitle}`,
          mediaTitle: dTitle,
          mediaArtist: "Enlightened Radio",
          originalFile: nextSource
        });
      } else if (type === 'ad') {
        dTitle = adTitles.ads[nextSource] ? adTitles.ads[nextSource].title : nextSource;
        mediaQueue.push({
          url: adsFolder + nextSource,
          type: 'ad',
          displayTitle: `Ad: ${dTitle}`,
          mediaTitle: dTitle,
          mediaArtist: "Enlightened Radio Sponsor",
          originalFile: nextSource
        });
      }
      currentSongCount = 0;
    }
  }
  
  // Trigger eager preload using HTML5 Audio element caching
  mediaQueue.forEach(item => {
    if (!item.preloader) {
      item.preloader = new Audio();
      item.preloader.preload = 'auto'; // Will aggressively fetch the audio file into memory/disk cache 
      item.preloader.src = item.url;
    }
  });
}

function playFromQueue() {
  isAdvancing = false;
  if (!radioOn) return;
  fillQueue(); 
  
  if (mediaQueue.length === 0) {
    setTimeout(playFromQueue, 1000);
    return;
  }
  
  const nextItem = mediaQueue.shift();
  fillQueue(); // Trigger buffer of the next media
  
  updateNowPlaying(nextItem.displayTitle);
  updateMediaSession(nextItem.mediaTitle, nextItem.mediaArtist);
  
  audioElement.src = nextItem.url;
  
  if (nextItem.type === 'voice' || nextItem.type === 'intro') {
    bandpass.disconnect();
    distortion.disconnect();
    musicGain.disconnect();
    voiceDistortion.disconnect();
    voiceGain.disconnect();
    voiceDistortion.connect(voiceGain);
    voiceGain.connect(audioContext.destination);
  } else {
    voiceDistortion.disconnect();
    voiceGain.disconnect();
    bandpass.connect(distortion);
    distortion.connect(musicGain);
    musicGain.connect(audioContext.destination);
  }
  
  audioElement.play().catch(e => console.error("Playback failed:", e));
}

// Example usage for Immersive Mode:
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
  bandpass.disconnect();
  distortion.disconnect();
  musicGain.disconnect();
  voiceDistortion.disconnect();
  voiceGain.disconnect();
  voiceDistortion.connect(voiceGain);
  voiceGain.connect(audioContext.destination);
  audioElement.play().catch(() => { });
  
  fillQueue(); // Begin eagerly caching future tracks immediately!
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

// Set up Media Session Action Handlers once
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    if (!radioOn) powerOn();
    else audioContext.resume().then(() => audioElement.play().catch(() => {}));
  });
  navigator.mediaSession.setActionHandler('pause', () => powerOff());
  navigator.mediaSession.setActionHandler('stop', () => powerOff());
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if (radioOn) playFromQueue();
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
      // If state loaded AND we have a source, we are ready to play when powered on
      // We do NOT play automatically here, powerOn handles the resume
    } else {
      playIntroduction();
    }
  }
}


function powerOn() {
  if (radioOn) return;
  radioOn = true;
  audioContext.resume().then(() => {
    const volume = parseFloat(volumeSlider.value);
    const baseStatic = 0.001;
    const dynamicStatic = 0.0015;
    staticGain.gain.value = (baseStatic + dynamicStatic * Math.sqrt(volume)) * (1 - volume * 0.3);
    // Resume static
    // Resume music/audio
    if (audioElement.paused && audioElement.src) {
      let src = audioElement.src;
      if (src) {
        if (src.includes(songsFolder)) {
          const songFile = src.split('/').pop();
          const displayTitle = songTitles[songFile] ? songTitles[songFile].title : songFile;
          updateNowPlaying(`Now Playing: ${displayTitle}`);

          let title = displayTitle, artist = "Unknown Artist";
          const lastByIndex = displayTitle.lastIndexOf(" by ");
          if (lastByIndex !== -1) {
            title = displayTitle.substring(0, lastByIndex);
            artist = displayTitle.substring(lastByIndex + 4);
          }
          updateMediaSession(title, artist);
        } else if (src.includes(adsFolder)) {
          const adFile = src.split('/').pop();
          const displayTitle = adTitles.ads[adFile] ? adTitles.ads[adFile].title : adFile;
          updateNowPlaying(`Ad: ${displayTitle}`);
          updateMediaSession(displayTitle, "Enlightened Radio Sponsor");
        } else if (src.includes(playsFolder)) {
          const playFile = src.split('/').pop();
          const displayTitle = adTitles.plays[playFile] ? adTitles.plays[playFile].title : playFile;
          updateNowPlaying(`Radio Play: ${displayTitle}`);
          updateMediaSession(displayTitle, "Enlightened Radio");
        } else if (src.includes(hostFolder)) {
          const hostFile = src.split('/').pop();
          updateNowPlaying(`Host: ${hostFile}`);
          updateMediaSession(`Host: ${hostFile}`, "Host");
        } else if (src.includes(introFile)) {
          updateNowPlaying('Welcome to Enlightened Radio');
          updateMediaSession('Welcome to Enlightened Radio', "Host");
        }
      }
      audioElement.play().catch(() => { });
    }
    // Only play introduction if never initialized
    if (!initialized) {
      initializeRadio();
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
  staticGain.gain.value = 0;
  // Pause static and music/voice immediately
  audioElement.pause();
  // No need to stop staticNoise, just mute via gain
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
    // radioOn = false; // already set in powerOff
  } else {
    powerOn();
    // radioOn = true; // already set in powerOn
  }
}

// Persistence Logic

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
    mediaQueue: mediaQueue.map(item => ({...item, preloader: null})), // Can't serialize Audio object
    // Modifiers
    immersiveMode: document.getElementById('immersiveMode')?.checked || false,
    falloutMode: document.getElementById('falloutMode')?.checked || false,
    adFreeMode: document.getElementById('adFreeMode')?.checked || false,
    familyFriendlyMode: document.getElementById('familyFriendlyMode')?.checked || false
  };
  localStorage.setItem('radioState', JSON.stringify(state));
}

window.addEventListener('beforeunload', saveState);

// Add change listeners to checkboxes for immediate saving
document.getElementById('immersiveMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('falloutMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('adFreeMode')?.addEventListener('change', handleModifierToggle);
document.getElementById('familyFriendlyMode')?.addEventListener('change', handleModifierToggle);
// Also load state on page load to restore checkbox UI immediately
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
    
    mediaQueue = state.mediaQueue || [];
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

    // Restore Modifiers
    const immersiveCheckbox = document.getElementById('immersiveMode');
    if (immersiveCheckbox) immersiveCheckbox.checked = state.immersiveMode || false;

    const falloutCheckbox = document.getElementById('falloutMode');
    if (falloutCheckbox) falloutCheckbox.checked = state.falloutMode || false;

    const adFreeCheckbox = document.getElementById('adFreeMode');
    if (adFreeCheckbox) adFreeCheckbox.checked = state.adFreeMode || false;

    const familyFriendlyCheckbox = document.getElementById('familyFriendlyMode');
    if (familyFriendlyCheckbox) familyFriendlyCheckbox.checked = state.familyFriendlyMode || false;

    return true; // State loaded
  }
  return false; // No state found
}


function resetRadio() {
  isResetting = true;
  localStorage.removeItem('radioState');
  localStorage.removeItem('radioVolume'); // Optional: reset volume too? Maybe keep volume.
  location.reload();
}

// Filters Dropdown Toggle
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


