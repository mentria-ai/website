/**
 * OctoBeats Radio - Minimalistic Music Player
 * Powered by Mentria.AI
 */

class OctoBeatsRadio {
    constructor() {
        // Core properties
        this.audio = null;
        this.tracks = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.isLoading = false;
        this.volume = 1.0;
        this.isMuted = false;
        
        // Schedule properties
        this.schedule = new Map();
        this.isLiveMode = true;
        this.currentTimeSlot = 0; // Minutes from 00:00
        
        // Visualizer properties
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.canvas = null;
        this.canvasContext = null;
        this.animationId = null;
        this.equalizerBars = null;
        
        // Clock properties
        this.clockUpdateInterval = null;
        
        // DOM elements
        this.elements = {};
        
        // Initialize the app
        this.init();
    }
    
    /**
     * Initialize the radio application
     */
    async init() {
        try {
            this.initializeElements();
            this.createAudioElement();
            this.bindEvents();
            this.setupMediaSession();
            this.setupKeyboardShortcuts();
            this.initializeClock();
            this.initializeTimeSlider();
            this.initializeVisualizer();
            await this.loadTracks();
            this.startLiveMode();
            
            console.log('🎵 OctoBeats Radio initialized successfully');
        } catch (error) {
            console.error('Failed to initialize OctoBeats Radio:', error);
            this.showError('Failed to initialize the music player');
        }
    }
    
    /**
     * Initialize DOM elements
     */
    initializeElements() {
        this.elements = {
            // Visualizer
            audioVisualizer: document.getElementById('audioVisualizer'),
            visualizerCanvas: document.getElementById('visualizerCanvas'),
            visualizerFallback: document.getElementById('visualizerFallback'),
            
            // Controls
            playButton: document.getElementById('playButton'),
            prevButton: document.getElementById('prevButton'),
            nextButton: document.getElementById('nextButton'),
            
            // Clock
            clockFace: document.getElementById('clockFace'),
            clockTime: document.getElementById('clockTime'),
            hourHand: document.getElementById('hourHand'),
            minuteHand: document.getElementById('minuteHand'),
            
            // Time slider
            timeSlider: document.getElementById('timeSlider'),
            timeTicks: document.getElementById('timeTicks'),
            
            // Track info
            currentTrackChip: document.getElementById('currentTrackChip'),
            trackInfo: document.getElementById('trackInfo'),
            
            // Download
            downloadButton: document.getElementById('downloadButton')
        };
        
        // Get equalizer bars
        this.equalizerBars = this.elements.visualizerFallback?.querySelector('.equalizer-bars');
        
        // Validate required elements
        const requiredElements = ['playButton', 'trackInfo'];
        for (const elementId of requiredElements) {
            if (!this.elements[elementId]) {
                throw new Error(`Required element not found: ${elementId}`);
            }
        }
    }
    
    /**
     * Create and configure audio element
     */
    createAudioElement() {
        this.audio = document.createElement('audio');
        this.audio.preload = 'metadata';
        this.audio.volume = this.volume;
        this.audio.crossOrigin = 'anonymous';
        
        // Audio event listeners
        this.audio.addEventListener('loadstart', () => this.onLoadStart());
        this.audio.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
        this.audio.addEventListener('canplay', () => this.onCanPlay());
        this.audio.addEventListener('play', () => this.onPlay());
        this.audio.addEventListener('pause', () => this.onPause());
        this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
        this.audio.addEventListener('ended', () => this.onEnded());
        this.audio.addEventListener('error', (e) => this.onError(e));
        
        document.body.appendChild(this.audio);
    }
    
    /**
     * Initialize analog-digital clock
     */
    initializeClock() {
        this.updateClock();
        // Update every second for smooth hand movement
        this.clockUpdateInterval = setInterval(() => {
            this.updateClock();
            // Check for schedule updates every minute
            if (this.isLiveMode && new Date().getSeconds() === 0) {
                this.checkScheduleUpdate();
            }
        }, 1000);
    }
    
    /**
     * Update clock display and hands
     */
    updateClock() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        
        // Update digital time display
        if (this.elements.clockTime) {
            const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            this.elements.clockTime.textContent = timeString;
        }
        
        // Update analog hands
        if (this.elements.hourHand) {
            const hourAngle = ((hours % 12) + minutes / 60) * 30; // 30 degrees per hour
            this.elements.hourHand.style.transform = `rotate(${hourAngle}deg)`;
        }
        
        if (this.elements.minuteHand) {
            const minuteAngle = (minutes + seconds / 60) * 6; // 6 degrees per minute
            this.elements.minuteHand.style.transform = `rotate(${minuteAngle}deg)`;
        }
    }
    
    /**
     * Initialize 24h time slider
     */
    initializeTimeSlider() {
        if (!this.elements.timeSlider) return;
        
        // Set current time as initial value
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        this.currentTimeSlot = Math.floor(currentMinutes / 30) * 30; // Round to nearest 30min
        this.elements.timeSlider.value = this.currentTimeSlot;
        
        // Generate time ticks
        this.generateTimeTicks();
    }
    
    /**
     * Generate time ticks for the slider
     */
    generateTimeTicks() {
        if (!this.elements.timeTicks) return;
        
        // Ticks are handled by CSS repeating-linear-gradient
        // This creates major ticks every 2 hours (12 total)
    }
    
    /**
     * Initialize audio visualizer
     */
    initializeVisualizer() {
        if (!this.elements.visualizerCanvas) return;
        
        this.canvas = this.elements.visualizerCanvas;
        this.canvasContext = this.canvas.getContext('2d');
        
        // Set canvas size
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.canvasContext.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        // Show fallback initially
        if (this.elements.visualizerFallback) {
            this.elements.visualizerFallback.style.display = 'flex';
        }
        
        // Stop equalizer animation initially
        this.stopEqualizerAnimation();
    }
    
    /**
     * Setup audio context for visualizer
     */
    setupAudioContext() {
        if (!this.audio || this.audioContext) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaElementSource(this.audio);
            
            source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Hide fallback and start visualization
            if (this.elements.visualizerFallback) {
                this.elements.visualizerFallback.style.display = 'none';
            }
            
            this.startVisualization();
        } catch (error) {
            console.warn('Audio visualization not supported:', error);
            // Keep using fallback equalizer
        }
    }
    
    /**
     * Start audio visualization
     */
    startVisualization() {
        if (!this.analyser || !this.canvasContext) return;
        
        const draw = () => {
            if (!this.isPlaying) return; // Stop when not playing
            
            this.animationId = requestAnimationFrame(draw);
            
            this.analyser.getByteFrequencyData(this.dataArray);
            
            const width = this.canvas.width / window.devicePixelRatio;
            const height = this.canvas.height / window.devicePixelRatio;
            
            this.canvasContext.clearRect(0, 0, width, height);
            
            // Focus on mid-range frequencies (more common in music)
            const startFreq = 20; // Skip very low frequencies
            const endFreq = 80;   // Skip very high frequencies
            const usefulData = this.dataArray.slice(startFreq, endFreq);
            
            const barWidth = width / usefulData.length;
            let x = 0;
            
            for (let i = 0; i < usefulData.length; i++) {
                const barHeight = (usefulData[i] / 255) * height * 0.8;
                
                // Create gradient
                const gradient = this.canvasContext.createLinearGradient(0, height, 0, height - barHeight);
                gradient.addColorStop(0, '#0A84FF');
                gradient.addColorStop(1, '#0066CC');
                
                this.canvasContext.fillStyle = gradient;
                this.canvasContext.fillRect(x, height - barHeight, barWidth - 1, barHeight);
                
                x += barWidth;
            }
        };
        
        if (this.isPlaying) {
            draw();
        }
    }
    
    /**
     * Stop audio visualization
     */
    stopVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.canvasContext) {
            const width = this.canvas.width / window.devicePixelRatio;
            const height = this.canvas.height / window.devicePixelRatio;
            this.canvasContext.clearRect(0, 0, width, height);
        }
        
        // Show fallback
        if (this.elements.visualizerFallback) {
            this.elements.visualizerFallback.style.display = 'flex';
        }
        
        // Stop equalizer animation
        this.stopEqualizerAnimation();
    }
    
    /**
     * Start equalizer animation
     */
    startEqualizerAnimation() {
        if (this.equalizerBars) {
            this.equalizerBars.classList.add('playing');
        }
    }
    
    /**
     * Stop equalizer animation
     */
    stopEqualizerAnimation() {
        if (this.equalizerBars) {
            this.equalizerBars.classList.remove('playing');
        }
    }
    
    /**
     * Generate schedule for tracks
     */
    generateSchedule() {
        if (this.tracks.length === 0) return;
        
        this.schedule.clear();
        
        // Start from May 28, 2025
        const startDate = new Date('2025-05-28');
        const today = new Date();
        
        // Generate schedule for 7 days from start date
        for (let day = 0; day < 7; day++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + day);
            
            // Skip future dates
            if (currentDate > today) continue;
            
            const dateString = currentDate.toISOString().split('T')[0];
            
            // Assign tracks to 30-minute slots
            for (let hour = 0; hour < 24; hour++) {
                for (let minute = 0; minute < 60; minute += 30) {
                    const timeSlot = hour * 60 + minute;
                    const trackIndex = timeSlot % this.tracks.length;
                    const scheduleKey = `${dateString}-${timeSlot}`;
                    
                    this.schedule.set(scheduleKey, {
                        trackIndex,
                        date: dateString,
                        timeSlot,
                        hour,
                        minute
                    });
                }
            }
        }
    }
    
    /**
     * Get current time slot
     */
    getCurrentTimeSlot() {
        const now = new Date();
        const hour = now.getHours();
        const minute = Math.floor(now.getMinutes() / 30) * 30;
        return hour * 60 + minute;
    }
    
    /**
     * Get track for current time
     */
    getCurrentTrack() {
        const now = new Date();
        const dateString = now.toISOString().split('T')[0];
        const timeSlot = this.getCurrentTimeSlot();
        const scheduleKey = `${dateString}-${timeSlot}`;
        
        return this.schedule.get(scheduleKey);
    }
    
    /**
     * Start live mode
     */
    startLiveMode() {
        this.isLiveMode = true;
        this.checkScheduleUpdate();
        
        // Update time slider to current time
        const currentTimeSlot = this.getCurrentTimeSlot();
        if (this.elements.timeSlider) {
            this.elements.timeSlider.value = currentTimeSlot;
        }
        this.currentTimeSlot = currentTimeSlot;
    }
    
    /**
     * Stop live mode
     */
    stopLiveMode() {
        this.isLiveMode = false;
    }
    
    /**
     * Check if schedule needs to be updated
     */
    checkScheduleUpdate() {
        if (!this.isLiveMode) return;
        
        const currentTrack = this.getCurrentTrack();
        if (currentTrack && currentTrack.trackIndex !== this.currentIndex) {
            this.loadTrack(currentTrack.trackIndex);
        }
        
        // Update time slider
        const currentTimeSlot = this.getCurrentTimeSlot();
        if (this.elements.timeSlider && currentTimeSlot !== this.currentTimeSlot) {
            this.elements.timeSlider.value = currentTimeSlot;
            this.currentTimeSlot = currentTimeSlot;
        }
    }
    
    /**
     * Bind UI event listeners
     */
    bindEvents() {
        // Control buttons
        this.elements.playButton?.addEventListener('click', () => this.togglePlayPause());
        this.elements.prevButton?.addEventListener('click', () => this.previousTrack());
        this.elements.nextButton?.addEventListener('click', () => this.nextTrack());
        
        // Time slider
        this.elements.timeSlider?.addEventListener('input', (e) => this.onTimeSliderChange(e));
        this.elements.timeSlider?.addEventListener('change', (e) => this.onTimeSliderChange(e));
        
        // Download
        this.elements.downloadButton?.addEventListener('click', () => this.downloadCurrentTrack());
        
        // Window events
        window.addEventListener('beforeunload', () => this.cleanup());
        window.addEventListener('resize', () => this.handleResize());
    }
    
    /**
     * Handle time slider change
     */
    onTimeSliderChange(event) {
        const timeSlot = parseInt(event.target.value);
        this.currentTimeSlot = timeSlot;
        
        // Stop live mode when manually changing time
        this.stopLiveMode();
        
        // Find track for this time slot
        const today = new Date().toISOString().split('T')[0];
        const scheduleKey = `${today}-${timeSlot}`;
        const scheduledTrack = this.schedule.get(scheduleKey);
        
        if (scheduledTrack) {
            this.loadTrack(scheduledTrack.trackIndex);
        }
    }
    
    /**
     * Handle window resize
     */
    handleResize() {
        if (this.canvas && this.canvasContext) {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = rect.width * window.devicePixelRatio;
            this.canvas.height = rect.height * window.devicePixelRatio;
            this.canvasContext.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
    }
    
    /**
     * Setup Media Session API
     */
    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;
        
        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
    }
    
    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.previousTrack();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.nextTrack();
                    break;
                case 'KeyL':
                    e.preventDefault();
                    this.startLiveMode();
                    break;
            }
        });
    }
    
    /**
     * Load tracks from manifest
     */
    async loadTracks() {
        try {
            this.setLoading(true);
            
            const response = await fetch('assets/audios/manifest.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.tracks = data.tracks || [];
            
            // Generate schedule after loading tracks
            this.generateSchedule();
            
            if (this.tracks.length > 0) {
                // Load current track based on time
                const currentTrack = this.getCurrentTrack();
                if (currentTrack) {
                    this.loadTrack(currentTrack.trackIndex);
                } else {
                    this.loadTrack(0);
                }
            } else {
                this.showEmptyState();
            }
            
        } catch (error) {
            console.error('Failed to load tracks:', error);
            this.showEmptyState('Failed to load music tracks');
        } finally {
            this.setLoading(false);
        }
    }
    
    /**
     * Load a specific track
     */
    loadTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        
        const wasPlaying = this.isPlaying;
        this.pause();
        
        this.currentIndex = index;
        const track = this.tracks[index];
        
        // Update UI immediately
        this.updateTrackInfo(track);
        
        // Load audio
        this.audio.src = track.file;
        
        // Update media session
        this.updateMediaSession(track);
        
        // Show download button
        if (this.elements.downloadButton) {
            this.elements.downloadButton.style.display = 'flex';
        }
        
        // Resume playback if it was playing
        if (wasPlaying) {
            this.audio.addEventListener('canplay', () => this.play(), { once: true });
        }
    }
    
    /**
     * Update track information display
     */
    updateTrackInfo(track) {
        if (this.elements.trackInfo) {
            // Format as "Title – Artist"
            const trackText = `${track.title} – mentria.ai`;
            this.elements.trackInfo.textContent = trackText;
        }
    }
    
    /**
     * Update Media Session metadata
     */
    updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;
        
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Unknown Track',
            artist: 'mentria.ai',
            album: 'AI Generated Music',
            artwork: [
                { src: 'icon-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png' }
            ]
        });
    }
    
    /**
     * Show empty state
     */
    showEmptyState(message = null) {
        if (this.elements.trackInfo) {
            this.elements.trackInfo.textContent = message || 'No tracks available – Generate music to get started';
        }
        
        // Hide download button
        if (this.elements.downloadButton) {
            this.elements.downloadButton.style.display = 'none';
        }
    }
    
    /**
     * Play/pause toggle
     */
    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    /**
     * Play current track
     */
    async play() {
        if (!this.audio || !this.audio.src) return;
        
        try {
            // Setup audio context for visualizer on first play
            if (!this.audioContext) {
                this.setupAudioContext();
            }
            
            await this.audio.play();
        } catch (error) {
            console.error('Failed to play audio:', error);
            this.showError('Failed to play audio');
        }
    }
    
    /**
     * Pause current track
     */
    pause() {
        if (this.audio) {
            this.audio.pause();
        }
    }
    
    /**
     * Go to previous track
     */
    previousTrack() {
        if (this.tracks.length === 0) return;
        
        this.stopLiveMode();
        
        const newIndex = this.currentIndex > 0 
            ? this.currentIndex - 1 
            : this.tracks.length - 1;
        
        this.loadTrack(newIndex);
    }
    
    /**
     * Go to next track
     */
    nextTrack() {
        if (this.tracks.length === 0) return;
        
        this.stopLiveMode();
        
        const newIndex = this.currentIndex < this.tracks.length - 1 
            ? this.currentIndex + 1 
            : 0;
        
        this.loadTrack(newIndex);
    }
    
    /**
     * Download current track
     */
    downloadCurrentTrack() {
        if (!this.tracks[this.currentIndex]) return;
        
        const track = this.tracks[this.currentIndex];
        const link = document.createElement('a');
        link.href = track.file;
        link.download = `${track.title}.mp3`;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    /**
     * Set loading state
     */
    setLoading(loading) {
        this.isLoading = loading;
        
        if (loading && this.elements.trackInfo) {
            this.elements.trackInfo.textContent = 'Loading...';
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        console.error(message);
    }
    
    /**
     * Update play button state
     */
    updatePlayButton() {
        if (!this.elements.playButton) return;
        
        const playIcon = this.elements.playButton.querySelector('.play-icon');
        const pauseIcon = this.elements.playButton.querySelector('.pause-icon');
        
        if (this.isPlaying) {
            if (playIcon) playIcon.style.display = 'none';
            if (pauseIcon) pauseIcon.style.display = 'block';
            this.elements.playButton.setAttribute('aria-label', 'Pause');
        } else {
            if (playIcon) playIcon.style.display = 'block';
            if (pauseIcon) pauseIcon.style.display = 'none';
            this.elements.playButton.setAttribute('aria-label', 'Play');
        }
    }
    
    // Audio event handlers
    onLoadStart() {
        this.setLoading(true);
    }
    
    onLoadedMetadata() {
        // Metadata loaded
    }
    
    onCanPlay() {
        this.setLoading(false);
    }
    
    onPlay() {
        this.isPlaying = true;
        this.updatePlayButton();
        this.startEqualizerAnimation();
        
        // Start visualization if available
        if (this.audioContext) {
            this.startVisualization();
        }
    }
    
    onPause() {
        this.isPlaying = false;
        this.updatePlayButton();
        this.stopVisualization();
    }
    
    onTimeUpdate() {
        // Track progress updates can be handled here if needed
    }
    
    onEnded() {
        if (this.isLiveMode) {
            // In live mode, check for next scheduled track
            this.checkScheduleUpdate();
        } else {
            // In manual mode, go to next track
            this.nextTrack();
        }
    }
    
    onError(event) {
        console.error('Audio error:', event);
        this.showError('Failed to load audio track');
        this.setLoading(false);
    }
    
    /**
     * Cleanup resources
     */
    cleanup() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        if (this.clockUpdateInterval) {
            clearInterval(this.clockUpdateInterval);
        }
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
            this.audio.remove();
        }
    }
}

// Register Service Worker for PWA functionality
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/radio/sw.js')
            .then((registration) => {
                console.log('🎵 Service Worker registered successfully:', registration.scope);
            })
            .catch((error) => {
                console.log('❌ Service Worker registration failed:', error);
            });
    });
}

// Initialize the radio when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.octoBeatsRadio = new OctoBeatsRadio();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OctoBeatsRadio;
} 