/**
 * OctoBeats Radio - Modern Music Player
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
        
        // Program guide properties
        this.selectedDate = null;
        this.selectedTime = null;
        this.timeSlots = [];
        this.schedule = new Map(); // Map of date-time to track
        this.isLiveMode = true; // Auto-play based on current time
        
        // Visualizer properties
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.canvas = null;
        this.canvasContext = null;
        this.animationId = null;
        
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
            this.initializeDateTime();
            this.generateTimeSlots();
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
            // Date/Time
            currentDate: document.getElementById('currentDate'),
            currentTime: document.getElementById('currentTime'),
            
            // Track info
            trackTitle: document.getElementById('trackTitle'),
            trackArtist: document.getElementById('trackArtist'),
            trackSchedule: document.getElementById('trackSchedule'),
            
            // Controls
            playButton: document.getElementById('playButton'),
            prevButton: document.getElementById('prevButton'),
            nextButton: document.getElementById('nextButton'),
            
            // Progress
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            currentTrackTime: document.getElementById('currentTrackTime'),
            totalTime: document.getElementById('totalTime'),
            
            // Program guide popup
            programGuidePopup: document.getElementById('programGuidePopup'),
            closePopup: document.getElementById('closePopup'),
            dateDial: document.getElementById('dateDial'),
            timeDial: document.getElementById('timeDial'),
            trackDial: document.getElementById('trackDial'),
            cancelSelection: document.getElementById('cancelSelection'),
            playSelected: document.getElementById('playSelected'),
            
            // Visualizer
            visualizerContainer: document.getElementById('visualizerContainer'),
            audioVisualizer: document.getElementById('audioVisualizer'),
            visualizerFallback: document.getElementById('visualizerFallback'),
            
            // Download
            downloadButton: document.getElementById('downloadButton')
        };
        
        // Validate required elements
        const requiredElements = ['trackTitle', 'trackArtist', 'playButton'];
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
     * Initialize date and time display
     */
    initializeDateTime() {
        this.updateDateTime();
        // Update every minute
        setInterval(() => {
            this.updateDateTime();
            if (this.isLiveMode) {
                this.checkScheduleUpdate();
            }
        }, 60000);
    }
    
    /**
     * Update current date and time display
     */
    updateDateTime() {
        const now = new Date();
        const dateOptions = { weekday: 'short', day: 'numeric' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
        
        if (this.elements.currentDate) {
            this.elements.currentDate.textContent = now.toLocaleDateString('en-US', dateOptions);
        }
        
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = now.toLocaleTimeString('en-US', timeOptions);
        }
    }
    
    /**
     * Generate time slots for the time dial
     */
    generateTimeSlots() {
        this.timeSlots = [];
        
        // Generate 30-minute slots for 24 hours
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const timeString = `${hour.toString().padStart(2, '0')}${minute.toString().padStart(2, '0')}`;
                const displayTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                
                this.timeSlots.push({ value: timeString, display: displayTime });
            }
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
            
            // Assign tracks to time slots for this date
            this.timeSlots.forEach((slot, index) => {
                const trackIndex = (day * this.timeSlots.length + index) % this.tracks.length;
                const scheduleKey = `${dateString}-${slot.value}`;
                this.schedule.set(scheduleKey, {
                    trackIndex,
                    date: dateString,
                    time: slot.value,
                    displayTime: slot.display
                });
            });
        }
    }
    
    /**
     * Get current time slot
     */
    getCurrentTimeSlot() {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes() < 30 ? 0 : 30;
        return `${hour.toString().padStart(2, '0')}${minute.toString().padStart(2, '0')}`;
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
     * Start live mode - auto-play based on current time
     */
    startLiveMode() {
        this.isLiveMode = true;
        this.checkScheduleUpdate();
        
        if (this.elements.trackSchedule) {
            this.elements.trackSchedule.textContent = 'Live Radio • Auto-playing based on time';
        }
    }
    
    /**
     * Stop live mode
     */
    stopLiveMode() {
        this.isLiveMode = false;
        
        if (this.elements.trackSchedule) {
            this.elements.trackSchedule.textContent = 'Manual Mode • Selected from program guide';
        }
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
     * Initialize audio visualizer
     */
    initializeVisualizer() {
        if (!this.elements.audioVisualizer) return;
        
        this.canvas = this.elements.audioVisualizer;
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
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Hide fallback and start visualization
            if (this.elements.visualizerFallback) {
                this.elements.visualizerFallback.style.display = 'none';
            }
            
            this.startVisualization();
        } catch (error) {
            console.warn('Audio visualization not supported:', error);
        }
    }
    
    /**
     * Start audio visualization
     */
    startVisualization() {
        if (!this.analyser || !this.canvasContext) return;
        
        const draw = () => {
            this.animationId = requestAnimationFrame(draw);
            
            this.analyser.getByteFrequencyData(this.dataArray);
            
            const width = this.canvas.width / window.devicePixelRatio;
            const height = this.canvas.height / window.devicePixelRatio;
            
            this.canvasContext.clearRect(0, 0, width, height);
            
            const barWidth = width / this.dataArray.length;
            let x = 0;
            
            for (let i = 0; i < this.dataArray.length; i++) {
                const barHeight = (this.dataArray[i] / 255) * height * 0.8;
                
                // Create gradient
                const gradient = this.canvasContext.createLinearGradient(0, height, 0, height - barHeight);
                gradient.addColorStop(0, '#007AFF');
                gradient.addColorStop(1, '#5856D6');
                
                this.canvasContext.fillStyle = gradient;
                this.canvasContext.fillRect(x, height - barHeight, barWidth - 1, barHeight);
                
                x += barWidth;
            }
        };
        
        draw();
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
    }
    
    /**
     * Bind UI event listeners
     */
    bindEvents() {
        // Control buttons
        this.elements.playButton?.addEventListener('click', () => this.togglePlayPause());
        this.elements.prevButton?.addEventListener('click', () => this.previousTrack());
        this.elements.nextButton?.addEventListener('click', () => this.nextTrack());
        
        // Progress bar
        this.elements.progressBar?.addEventListener('click', (e) => this.seekToPosition(e));
        
        // Clock click to open program guide
        this.elements.currentTime?.addEventListener('click', () => this.openProgramGuide());
        
        // Program guide popup
        this.elements.closePopup?.addEventListener('click', () => this.closeProgramGuide());
        this.elements.cancelSelection?.addEventListener('click', () => this.closeProgramGuide());
        this.elements.playSelected?.addEventListener('click', () => this.playSelectedTrack());
        
        // Date selector
        this.elements.dateDial?.addEventListener('click', (e) => {
            if (e.target.classList.contains('date-option') && !e.target.classList.contains('disabled')) {
                this.selectDate(e.target.dataset.date);
            }
        });
        
        // Time selector
        this.elements.timeDial?.addEventListener('click', (e) => {
            if (e.target.classList.contains('time-slot') && !e.target.classList.contains('disabled')) {
                this.selectTime(e.target.dataset.time);
            }
        });
        
        // Track selector
        this.elements.trackDial?.addEventListener('click', (e) => {
            const trackItem = e.target.closest('.track-item');
            if (trackItem) {
                const index = parseInt(trackItem.dataset.index);
                this.selectTrackInPopup(index);
            }
        });
        
        // Download
        this.elements.downloadButton?.addEventListener('click', () => this.downloadCurrentTrack());
        
        // Close popup on overlay click
        this.elements.programGuidePopup?.addEventListener('click', (e) => {
            if (e.target === this.elements.programGuidePopup) {
                this.closeProgramGuide();
            }
        });
        
        // Window events
        window.addEventListener('beforeunload', () => this.cleanup());
        window.addEventListener('resize', () => this.handleResize());
    }
    
    /**
     * Open program guide popup
     */
    openProgramGuide() {
        if (this.elements.programGuidePopup) {
            this.elements.programGuidePopup.style.display = 'flex';
            this.generateDateOptions();
            this.renderTimeSlots();
            this.renderTracksInPopup();
        }
    }
    
    /**
     * Close program guide popup
     */
    closeProgramGuide() {
        if (this.elements.programGuidePopup) {
            this.elements.programGuidePopup.style.display = 'none';
        }
    }
    
    /**
     * Generate date options for popup
     */
    generateDateOptions() {
        if (!this.elements.dateDial) return;
        
        const startDate = new Date('2025-05-28');
        const today = new Date();
        const datesHTML = [];
        
        for (let day = 0; day < 7; day++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + day);
            
            const dateString = currentDate.toISOString().split('T')[0];
            const displayDate = currentDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            const isDisabled = currentDate > today;
            const isActive = dateString === this.selectedDate;
            
            datesHTML.push(`
                <div class="date-option ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" 
                     data-date="${dateString}">
                    ${displayDate}
                </div>
            `);
        }
        
        this.elements.dateDial.innerHTML = datesHTML.join('');
        
        // Select today by default
        if (!this.selectedDate) {
            const todayString = today.toISOString().split('T')[0];
            this.selectDate(todayString);
        }
    }
    
    /**
     * Render time slots in popup
     */
    renderTimeSlots() {
        if (!this.elements.timeDial) return;
        
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentTimeSlot = this.getCurrentTimeSlot();
        
        const slotsHTML = this.timeSlots.map(slot => {
            const isDisabled = this.selectedDate === today && slot.value > currentTimeSlot;
            const isActive = slot.value === this.selectedTime;
            
            return `
                <div class="time-slot ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" 
                     data-time="${slot.value}">
                    ${slot.display}
                </div>
            `;
        }).join('');
        
        this.elements.timeDial.innerHTML = slotsHTML;
    }
    
    /**
     * Render tracks in popup
     */
    renderTracksInPopup() {
        if (!this.elements.trackDial || !this.selectedDate || !this.selectedTime) {
            if (this.elements.trackDial) {
                this.elements.trackDial.innerHTML = '<div class="empty-state"><div class="empty-state-description">Select date and time to see available tracks</div></div>';
            }
            return;
        }
        
        const scheduleKey = `${this.selectedDate}-${this.selectedTime}`;
        const scheduledTrack = this.schedule.get(scheduleKey);
        
        if (!scheduledTrack) {
            this.elements.trackDial.innerHTML = '<div class="empty-state"><div class="empty-state-description">No tracks scheduled for this time</div></div>';
            return;
        }
        
        const track = this.tracks[scheduledTrack.trackIndex];
        if (!track) return;
        
        const trackHTML = `
            <div class="track-item active" data-index="${scheduledTrack.trackIndex}">
                <div class="track-number">1</div>
                <div class="track-details">
                    <div class="track-name">${this.escapeHtml(track.title)}</div>
                    <div class="track-meta">mentria.ai • Scheduled for ${scheduledTrack.displayTime}</div>
                </div>
            </div>
        `;
        
        this.elements.trackDial.innerHTML = trackHTML;
    }
    
    /**
     * Select a date in popup
     */
    selectDate(date) {
        this.selectedDate = date;
        
        // Update UI
        this.elements.dateDial?.querySelectorAll('.date-option').forEach(option => {
            option.classList.toggle('active', option.dataset.date === date);
        });
        
        // Update time slots and tracks
        this.renderTimeSlots();
        this.renderTracksInPopup();
    }
    
    /**
     * Select a time slot in popup
     */
    selectTime(time) {
        this.selectedTime = time;
        
        // Update UI
        this.elements.timeDial?.querySelectorAll('.time-slot').forEach(slot => {
            slot.classList.toggle('active', slot.dataset.time === time);
        });
        
        // Update tracks
        this.renderTracksInPopup();
    }
    
    /**
     * Select a track in popup
     */
    selectTrackInPopup(index) {
        // Track is already selected by schedule, just update UI
        this.elements.trackDial?.querySelectorAll('.track-item').forEach((item, i) => {
            item.classList.toggle('active', parseInt(item.dataset.index) === index);
        });
    }
    
    /**
     * Play selected track from popup
     */
    playSelectedTrack() {
        if (!this.selectedDate || !this.selectedTime) return;
        
        const scheduleKey = `${this.selectedDate}-${this.selectedTime}`;
        const scheduledTrack = this.schedule.get(scheduleKey);
        
        if (scheduledTrack) {
            this.stopLiveMode();
            this.loadTrack(scheduledTrack.trackIndex);
            this.closeProgramGuide();
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
     * Setup Media Session API for system integration
     */
    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;
        
        navigator.mediaSession.setActionHandler('play', () => this.play());
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime && this.audio) {
                this.audio.currentTime = details.seekTime;
            }
        });
    }
    
    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't handle shortcuts if user is typing or popup is open
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (this.elements.programGuidePopup?.style.display === 'flex') {
                if (e.code === 'Escape') {
                    this.closeProgramGuide();
                }
                return;
            }
            
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
                case 'KeyG':
                    e.preventDefault();
                    this.openProgramGuide();
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
        if (this.elements.trackTitle) {
            this.elements.trackTitle.textContent = track.title || 'Unknown Track';
        }
        
        if (this.elements.trackArtist) {
            this.elements.trackArtist.textContent = 'mentria.ai';
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
        // Update track info
        if (this.elements.trackTitle) {
            this.elements.trackTitle.textContent = 'No tracks available';
        }
        if (this.elements.trackArtist) {
            this.elements.trackArtist.textContent = 'Generate music to get started';
        }
        if (this.elements.trackSchedule) {
            this.elements.trackSchedule.textContent = message || 'Generate music using the OctoBeats workflow';
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
     * Seek to position in track
     */
    seekToPosition(event) {
        if (!this.audio || !this.audio.duration) return;
        
        const rect = this.elements.progressBar.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        const newTime = percent * this.audio.duration;
        
        this.audio.currentTime = Math.max(0, Math.min(newTime, this.audio.duration));
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
        
        if (loading && this.elements.trackTitle) {
            this.elements.trackTitle.textContent = 'Loading...';
        }
    }
    
    /**
     * Show error message
     */
    showError(message) {
        console.error(message);
        // In a real app, you might want to show a toast notification
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
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Update progress bar
     */
    updateProgress() {
        if (!this.audio || !this.audio.duration) return;
        
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        
        if (this.elements.progressFill) {
            this.elements.progressFill.style.width = `${percent}%`;
        }
        
        if (this.elements.currentTrackTime) {
            this.elements.currentTrackTime.textContent = this.formatTime(this.audio.currentTime);
        }
    }
    
    /**
     * Update play button state
     */
    updatePlayButton() {
        if (!this.elements.playButton) return;
        
        if (this.isPlaying) {
            this.elements.playButton.innerHTML = '⏸';
            this.elements.playButton.setAttribute('aria-label', 'Pause');
        } else {
            this.elements.playButton.innerHTML = '▶';
            this.elements.playButton.setAttribute('aria-label', 'Play');
        }
    }
    
    // Audio event handlers
    onLoadStart() {
        this.setLoading(true);
    }
    
    onLoadedMetadata() {
        if (this.elements.totalTime) {
            this.elements.totalTime.textContent = this.formatTime(this.audio.duration);
        }
    }
    
    onCanPlay() {
        this.setLoading(false);
    }
    
    onPlay() {
        this.isPlaying = true;
        this.updatePlayButton();
    }
    
    onPause() {
        this.isPlaying = false;
        this.updatePlayButton();
        this.stopVisualization();
    }
    
    onTimeUpdate() {
        this.updateProgress();
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