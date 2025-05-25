# 🎵 OctoBeats Radio

A modern, minimalist web interface for playing AI-generated music from the OctoBeats workflow by mentria.ai.

## 🚀 Features

- **Modern UI**: Clean, dark-themed interface with smooth animations
- **Audio Controls**: Play, pause, next, previous, shuffle, repeat
- **Equalizer Visualization**: Real-time audio frequency visualization
- **Playlist Management**: Automatic discovery of generated tracks
- **Keyboard Shortcuts**: Full keyboard control support
- **Responsive Design**: Works on desktop and mobile devices
- **PWA Support**: Can be installed as a Progressive Web App

## 🎮 Controls

### Audio Controls
- **Play/Pause**: Click the main play button or press `Space`
- **Next Track**: Click next button or press `→`
- **Previous Track**: Click previous button or press `←`
- **Volume**: Use the volume slider or press `↑`/`↓`
- **Mute**: Click volume button or press `M`

### Playlist Controls
- **Shuffle**: Click shuffle button or press `S`
- **Repeat**: Click repeat button or press `R` (cycles through: off → all → one)
- **Refresh**: Click refresh button or press `F`

### Additional Shortcuts
- **Seek**: Click anywhere on the progress bar
- **Install App**: Click install button (when available)

## 📁 File Structure

```
build/radio/
├── index.html              # Main HTML file
├── assets/
│   ├── css/
│   │   └── radio.css       # Styles and animations
│   ├── js/
│   │   ├── audio-engine.js # Audio playback engine
│   │   ├── equalizer.js    # Equalizer visualization
│   │   ├── playlist.js     # Playlist management
│   │   └── radio.js        # Main application
│   └── audios/
│       ├── manifest.json   # Track listing (auto-generated)
│       └── *.mp3          # Generated audio files
└── README.md              # This file
```

## 🎵 How It Works

1. **Audio Generation**: Use the OctoBeats workflow to generate music by creating GitHub issues with the `audio` label
2. **Automatic Discovery**: Generated tracks are automatically added to the radio interface
3. **Real-time Updates**: The playlist refreshes every 30 seconds to discover new tracks
4. **Metadata Integration**: Track information is extracted from the generation metadata

## 🔧 Technical Details

### Audio Engine
- HTML5 Audio API for playback
- Web Audio API for frequency analysis
- Support for MP3 format
- Automatic volume and playback state management

### Equalizer
- Real-time frequency analysis using Web Audio API
- Fallback animation for unsupported browsers
- Responsive bar count based on screen size
- Smooth animations with CSS transitions

### Playlist
- Automatic track discovery via manifest file
- Support for metadata display
- Shuffle and repeat functionality
- Track duration and file size display

## 🌐 Browser Support

- **Modern Browsers**: Chrome, Firefox, Safari, Edge (latest versions)
- **Audio Features**: HTML5 Audio API support required
- **Equalizer**: Web Audio API support recommended (fallback available)
- **PWA**: Service Worker support for installation

## 📱 Mobile Support

- Touch-friendly controls
- Responsive layout
- Media Session API integration
- Background playback support

## 🎨 Customization

The interface uses CSS custom properties for easy theming:

```css
:root {
  --accent-primary: #6366f1;    /* Primary accent color */
  --accent-secondary: #8b5cf6;  /* Secondary accent color */
  --bg-primary: #0a0a0a;        /* Background color */
  /* ... more variables */
}
```

## 🔄 Integration with OctoBeats

The radio interface automatically integrates with the OctoBeats workflow:

1. Audio files are saved to `build/radio/assets/audios/`
2. Metadata files are created alongside audio files
3. The manifest file is updated automatically
4. The radio interface discovers new tracks via the manifest

## 🚀 Getting Started

1. **Generate Music**: Create a GitHub issue with the `audio` label and music parameters
2. **Wait for Generation**: The OctoBeats workflow will generate and save the audio
3. **Open Radio**: Navigate to `/radio/` in your browser
4. **Enjoy**: Your generated tracks will appear in the playlist automatically

## 🎧 Audio Quality

- **Fast Mode**: Quick generation, lower quality
- **Quality Mode**: Balanced generation time and quality
- **Ultra Mode**: Longer generation, highest quality

All modes produce high-quality MP3 files suitable for web playback.

---

**🎵 Enjoy your AI-generated music with OctoBeats Radio!** 