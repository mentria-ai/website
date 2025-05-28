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
        
        // Progress tracking
        this.isSeekingProgress = false;
        
        // Track loading
        this.pendingTrack = null; // Store track info for when audio is ready
        
        // Audio fade properties
        this.fadeInterval = null;
        this.targetVolume = 1.0;
        this.fadeStep = 0.05;
        this.fadeDuration = 300; // 300ms fade
        
        // Debounce properties
        this.lastPlayPauseTime = 0;
        this.playPauseDebounce = 300; // 300ms debounce
        
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
            equalizerGrid: document.getElementById('equalizerGrid'),
            
            // Controls
            playButton: document.getElementById('playButton'),
            prevButton: document.getElementById('prevButton'),
            nextButton: document.getElementById('nextButton'),
            
            // Clock
            digitalClock: document.getElementById('digitalClock'),
            clockTime: document.getElementById('clockTime'),
            
            // Audio progress
            audioProgressSlider: document.getElementById('audioProgressSlider'),
            currentTime: document.getElementById('currentTime'),
            totalTime: document.getElementById('totalTime'),
            
            // Track info
            currentTrackChip: document.getElementById('currentTrackChip'),
            trackInfo: document.getElementById('trackInfo'),
            
            // Download
            downloadButton: document.getElementById('downloadButton')
        };
        
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
     * Initialize digital clock
     */
    initializeClock() {
        this.updateClock();
        // Update every second
        this.clockUpdateInterval = setInterval(() => {
            this.updateClock();
            // Check for schedule updates every minute
            if (this.isLiveMode && new Date().getSeconds() === 0) {
                this.checkScheduleUpdate();
            }
        }, 1000);
    }
    
    /**
     * Update clock display
     */
    updateClock() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        
        // Update digital time display
        if (this.elements.clockTime) {
            const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            this.elements.clockTime.textContent = timeString;
        }
    }
    
    /**
     * Initialize audio visualizer
     */
    initializeVisualizer() {
        // Create grid cells for visualizer
        this.createVisualizerGrid();
        
        // Set initial dim state
        this.setVisualizerDimState();
        
        // Setup audio context for real-time visualization
        this.setupAudioContextForGrid();
    }
    
    /**
     * Setup audio context for grid visualization
     */
    setupAudioContextForGrid() {
        // We'll setup audio context when first playing
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
    }
    
    /**
     * Create the grid-based visualizer
     */
    createVisualizerGrid() {
        if (!this.elements.equalizerGrid) return;
        
        // Clear existing cells
        this.elements.equalizerGrid.innerHTML = '';
        
        // Create 20 columns x 8 rows = 160 cells
        const columns = 20;
        const rows = 8;
        this.visualizerCells = [];
        
        for (let row = 0; row < rows; row++) {
            this.visualizerCells[row] = [];
            for (let col = 0; col < columns; col++) {
                const cell = document.createElement('div');
                cell.className = 'equalizer-cell';
                
                // Mark top 2 rows as peak cells
                if (row < 2) {
                    cell.classList.add('peak');
                }
                
                this.elements.equalizerGrid.appendChild(cell);
                this.visualizerCells[row][col] = cell;
            }
        }
    }
    
    /**
     * Set visualizer to dim state (when not playing)
     */
    setVisualizerDimState() {
        if (!this.visualizerCells) return;
        
        this.visualizerCells.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                // Remove all level classes
                cell.className = cell.className.replace(/level-\d+/g, '');
                // Set to dim level
                cell.classList.add('level-0');
            });
        });
        
        // Remove playing class
        if (this.elements.equalizerGrid) {
            this.elements.equalizerGrid.classList.remove('playing');
        }
    }
    
    /**
     * Update visualizer grid based on audio data
     */
    updateVisualizerGrid(dataArray) {
        if (!this.visualizerCells || !dataArray) return;
        
        const columns = this.visualizerCells[0].length;
        const rows = this.visualizerCells.length;
        
        // Process audio data for each column
        for (let col = 0; col < columns; col++) {
            // Map column to frequency range
            const freqIndex = Math.floor((col / columns) * dataArray.length);
            let amplitude = dataArray[freqIndex] / 255; // Normalize to 0-1
            
            // Slightly more conservative amplification
            amplitude = Math.pow(amplitude, 0.85); // Even gentler power curve
            amplitude = Math.min(1, amplitude * 1.6); // Slightly lower multiplier
            
            // Calculate how many rows should be lit for this column
            const activeRows = Math.floor(amplitude * rows);
            
            // Update cells in this column (FIXED: start from bottom)
            for (let row = 0; row < rows; row++) {
                const cell = this.visualizerCells[row][col]; // Direct row mapping
                
                // Remove all level classes
                cell.className = cell.className.replace(/level-\d+/g, '');
                
                // Check if this row should be active (from bottom up)
                const rowFromBottom = rows - 1 - row;
                if (rowFromBottom < activeRows) {
                    // Calculate intensity level (0-5) with balanced distribution
                    const intensity = Math.min(5, Math.floor((amplitude * 5)));
                    cell.classList.add(`level-${Math.max(1, intensity)}`); // Minimum level 1 for active cells
                } else {
                    // Dim cell
                    cell.classList.add('level-0');
                }
            }
        }
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
            
            this.startVisualization();
        } catch (error) {
            console.warn('Audio visualization not supported:', error);
            // Keep using fallback animation
        }
    }
    
    /**
     * Start audio visualization
     */
    startVisualization() {
        if (!this.analyser) {
            // Fallback to animation
            this.startGridAnimation();
            return;
        }
        
        const draw = () => {
            if (!this.isPlaying) return; // Stop when not playing
            
            this.animationId = requestAnimationFrame(draw);
            
            this.analyser.getByteFrequencyData(this.dataArray);
            
            // Balanced frequency range
            const startFreq = 15; // Slightly lower than original
            const endFreq = 100;  // Slightly higher than original
            const usefulData = this.dataArray.slice(startFreq, endFreq);
            
            // Update grid with audio data
            this.updateVisualizerGrid(usefulData);
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
        
        // Set grid to dim state
        this.setVisualizerDimState();
    }
    
    /**
     * Start grid animation (fallback)
     */
    startGridAnimation() {
        if (this.elements.equalizerGrid) {
            this.elements.equalizerGrid.classList.add('playing');
        }
    }
    
    /**
     * Stop grid animation
     */
    stopGridAnimation() {
        if (this.elements.equalizerGrid) {
            this.elements.equalizerGrid.classList.remove('playing');
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
    }
    
    /**
     * Bind UI event listeners
     */
    bindEvents() {
        // Control buttons
        this.elements.playButton?.addEventListener('click', () => this.togglePlayPause());
        this.elements.prevButton?.addEventListener('click', () => this.previousTrack());
        this.elements.nextButton?.addEventListener('click', () => this.nextTrack());
        
        // Audio progress slider
        this.elements.audioProgressSlider?.addEventListener('input', (e) => this.onProgressSliderInput(e));
        this.elements.audioProgressSlider?.addEventListener('change', (e) => this.onProgressSliderChange(e));
        this.elements.audioProgressSlider?.addEventListener('mousedown', () => this.isSeekingProgress = true);
        this.elements.audioProgressSlider?.addEventListener('mouseup', () => this.isSeekingProgress = false);
        
        // Download
        this.elements.downloadButton?.addEventListener('click', () => this.downloadCurrentTrack());
        
        // Window events
        window.addEventListener('beforeunload', () => this.cleanup());
        window.addEventListener('resize', () => this.handleResize());
    }
    
    /**
     * Handle audio progress slider input
     */
    onProgressSliderInput(event) {
        if (!this.audio || !this.audio.duration) return;
        
        this.isSeekingProgress = true;
        
        // Switch to manual mode when user seeks
        this.stopLiveMode();
        
        const percent = parseFloat(event.target.value);
        const newTime = (percent / 100) * this.audio.duration;
        
        // Update time display immediately for responsiveness
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = this.formatTime(newTime);
        }
        
        // Ensure progress fill stays in sync during seeking
        this.updateProgressFill(percent);
    }
    
    /**
     * Handle audio progress slider change
     */
    onProgressSliderChange(event) {
        if (!this.audio || !this.audio.duration) return;
        
        const percent = parseFloat(event.target.value);
        const newTime = (percent / 100) * this.audio.duration;
        
        // Switch to manual mode when user seeks
        this.stopLiveMode();
        
        this.audio.currentTime = newTime;
        this.isSeekingProgress = false;
        
        // Force synchronization after seeking
        this.setProgressPosition(percent);
    }
    
    /**
     * Update audio progress slider
     */
    updateAudioProgress() {
        if (!this.audio || !this.audio.duration || this.isSeekingProgress) return;
        
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        
        // Update both slider and fill simultaneously
        this.setProgressPosition(percent);
        
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = this.formatTime(this.audio.currentTime);
        }
    }
    
    /**
     * Set progress position for both slider and fill (synchronized)
     */
    setProgressPosition(percent) {
        // Clamp percent between 0 and 100
        const clampedPercent = Math.max(0, Math.min(100, percent));
        
        if (this.elements.audioProgressSlider) {
            this.elements.audioProgressSlider.value = clampedPercent;
        }
        
        // Always update the visual progress fill in sync
        this.updateProgressFill(clampedPercent);
    }
    
    /**
     * Update progress slider visual fill
     */
    updateProgressFill(percent) {
        if (!this.elements.audioProgressSlider) return;
        
        // Create or update the progress fill overlay
        const progressWrapper = this.elements.audioProgressSlider.parentElement;
        let progressFill = progressWrapper.querySelector('.progress-fill');
        
        if (!progressFill) {
            progressFill = document.createElement('div');
            progressFill.className = 'progress-fill';
            progressWrapper.insertBefore(progressFill, this.elements.audioProgressSlider);
        }
        
        // Ensure exact synchronization by using the same percent value
        progressFill.style.width = `${percent}%`;
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
            
            console.log('Loaded tracks:', this.tracks); // Debug log
            
            // Generate schedule after loading tracks
            this.generateSchedule();
            
            // Stop loading before loading track to prevent overwriting track info
            this.setLoading(false);
            
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
            // Create a fallback track for testing
            this.tracks = [{
                id: 'fallback',
                title: 'Demo Track',
                artist: 'mentria.ai',
                file: 'assets/audios/audio_issue_42_20250525_105507.mp3',
                duration: 120
            }];
            
            // Stop loading before loading track
            this.setLoading(false);
            
            if (this.tracks.length > 0) {
                this.loadTrack(0);
            } else {
                this.showEmptyState('Failed to load music tracks');
            }
        }
    }
    
    /**
     * Load a specific track
     */
    loadTrack(index) {
        if (index < 0 || index >= this.tracks.length) {
            console.warn('Invalid track index:', index);
            return;
        }
        
        // Prevent loading the same track multiple times
        if (index === this.currentIndex && this.audio.src) {
            return;
        }
        
        const wasPlaying = this.isPlaying;
        this.pause();
        
        this.currentIndex = index;
        const track = this.tracks[index];
        
        // Load audio FIRST (this triggers loadstart and setLoading(true))
        this.audio.src = track.file;
        
        // Store track info to update when audio is ready (in onCanPlay)
        this.pendingTrack = track;
        
        // Update media session
        this.updateMediaSession(track);
        
        // Show download button (but keep it hidden)
        if (this.elements.downloadButton) {
            // Keep download functionality but button remains hidden
            this.elements.downloadButton.style.display = 'none';
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
        if (this.elements.trackInfo && track) {
            // Clean up the title - remove [MUSIC] prefix if present
            let cleanTitle = track.title || 'Unknown Track';
            if (cleanTitle.startsWith('[MUSIC]')) {
                cleanTitle = cleanTitle.replace('[MUSIC]', '').trim();
            }
            
            // Format as "Title – Artist"
            const trackText = `${cleanTitle} – mentria.ai`;
            this.elements.trackInfo.textContent = trackText;
            
        } else {
            console.warn('Missing trackInfo element or track data:', { 
                hasElement: !!this.elements.trackInfo, 
                track 
            });
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
     * Play/pause toggle with debounce
     */
    togglePlayPause() {
        const now = Date.now();
        if (now - this.lastPlayPauseTime < this.playPauseDebounce) {
            return; // Ignore rapid clicks
        }
        this.lastPlayPauseTime = now;
        
        if (this.isPlaying) {
            this.fadeOutAndPause();
        } else {
            this.playWithFadeIn();
        }
    }
    
    /**
     * Play with fade in
     */
    async playWithFadeIn() {
        if (!this.audio || !this.audio.src) return;
        
        try {
            // Setup audio context for visualizer on first play
            if (!this.audioContext) {
                this.setupAudioContext();
            }
            
            // Start with volume at 0
            this.audio.volume = 0;
            await this.audio.play();
            
            // Fade in
            this.fadeIn();
            
        } catch (error) {
            console.error('Failed to play audio:', error);
            this.showError('Failed to play audio');
        }
    }
    
    /**
     * Fade out and pause
     */
    fadeOutAndPause() {
        if (!this.audio) return;
        
        this.fadeOut(() => {
            this.audio.pause();
        });
    }
    
    /**
     * Fade in audio
     */
    fadeIn() {
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
        }
        
        const startVolume = 0;
        const endVolume = this.targetVolume;
        const steps = Math.ceil(this.fadeDuration / 16); // 60fps
        const volumeStep = (endVolume - startVolume) / steps;
        let currentStep = 0;
        
        this.audio.volume = startVolume;
        
        this.fadeInterval = setInterval(() => {
            currentStep++;
            const newVolume = startVolume + (volumeStep * currentStep);
            
            if (currentStep >= steps || newVolume >= endVolume) {
                this.audio.volume = endVolume;
                clearInterval(this.fadeInterval);
                this.fadeInterval = null;
            } else {
                this.audio.volume = newVolume;
            }
        }, 16);
    }
    
    /**
     * Fade out audio
     */
    fadeOut(callback) {
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
        }
        
        const startVolume = this.audio.volume;
        const endVolume = 0;
        const steps = Math.ceil(this.fadeDuration / 16); // 60fps
        const volumeStep = (startVolume - endVolume) / steps;
        let currentStep = 0;
        
        this.fadeInterval = setInterval(() => {
            currentStep++;
            const newVolume = startVolume - (volumeStep * currentStep);
            
            if (currentStep >= steps || newVolume <= endVolume) {
                this.audio.volume = endVolume;
                clearInterval(this.fadeInterval);
                this.fadeInterval = null;
                if (callback) callback();
            } else {
                this.audio.volume = newVolume;
            }
        }, 16);
    }
    
    /**
     * Play current track (direct play without fade)
     */
    async play() {
        if (!this.audio || !this.audio.src) return;
        
        try {
            // Setup audio context for visualizer on first play
            if (!this.audioContext) {
                this.setupAudioContext();
            }
            
            // Restore volume if it was faded out
            this.audio.volume = this.targetVolume;
            await this.audio.play();
        } catch (error) {
            console.error('Failed to play audio:', error);
            this.showError('Failed to play audio');
        }
    }
    
    /**
     * Pause current track (direct pause without fade)
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
            : this.tracks.length - 1; // Loop to last track
        
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
            : 0; // Loop back to first track
        
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
        // Don't overwrite track info when loading is false - let the track update handle it
    }
    
    /**
     * Show error message
     */
    showError(message) {
        console.error(message);
    }
    
    /**
     * Format time in MM:SS format
     */
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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
        // Update total time display
        if (this.elements.totalTime) {
            this.elements.totalTime.textContent = this.formatTime(this.audio.duration);
        }
        
        // Reset progress to 0 and ensure sync
        this.setProgressPosition(0);
    }
    
    onCanPlay() {
        // Don't call setLoading(false) here as it might overwrite track info
        this.isLoading = false;
        
        // Now update track info when audio is ready
        if (this.pendingTrack) {
            this.updateTrackInfo(this.pendingTrack);
            this.pendingTrack = null;
        }
    }
    
    onPlay() {
        this.isPlaying = true;
        this.updatePlayButton();
        this.startGridAnimation();
        
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
        this.updateAudioProgress();
    }
    
    onEnded() {
        if (this.isLiveMode) {
            // In live mode, check for next scheduled track
            this.checkScheduleUpdate();
        } else {
            // In manual mode, go to next track (which will loop)
            this.nextTrack();
            
            // Auto-play the next track to maintain continuous playback
            setTimeout(() => {
                if (!this.isPlaying) {
                    this.playWithFadeIn();
                }
            }, 200); // Slightly longer delay for better reliability
        }
    }
    
    onError(event) {
        console.error('❌ Audio error:', event);
        this.showError('Failed to load audio track');
        // Don't call setLoading(false) here as it might overwrite track info
        this.isLoading = false;
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
        
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
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