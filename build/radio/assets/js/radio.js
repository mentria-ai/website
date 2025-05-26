/**
 * OctoBeats Radio - Apple-inspired Music Player
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
            await this.loadTracks();
            
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
            // Track info
            trackTitle: document.getElementById('trackTitle'),
            trackArtist: document.getElementById('trackArtist'),
            
            // Controls
            playButton: document.getElementById('playButton'),
            prevButton: document.getElementById('prevButton'),
            nextButton: document.getElementById('nextButton'),
            
            // Progress
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            progressHandle: document.getElementById('progressHandle'),
            currentTime: document.getElementById('currentTime'),
            totalTime: document.getElementById('totalTime'),
            
            // Playlist
            playlist: document.getElementById('playlist'),
            refreshButton: document.getElementById('refreshButton'),
            
            // Download
            downloadButton: document.getElementById('downloadButton')
        };
        
        // Validate required elements
        const requiredElements = ['trackTitle', 'trackArtist', 'playButton', 'playlist'];
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
     * Bind UI event listeners
     */
    bindEvents() {
        // Control buttons
        this.elements.playButton?.addEventListener('click', () => this.togglePlayPause());
        this.elements.prevButton?.addEventListener('click', () => this.previousTrack());
        this.elements.nextButton?.addEventListener('click', () => this.nextTrack());
        
        // Progress bar
        this.elements.progressBar?.addEventListener('click', (e) => this.seekToPosition(e));
        
        // Playlist
        this.elements.refreshButton?.addEventListener('click', () => this.refreshPlaylist());
        
        // Download
        this.elements.downloadButton?.addEventListener('click', () => this.downloadCurrentTrack());
        
        // Window events
        window.addEventListener('beforeunload', () => this.cleanup());
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
            // Don't handle shortcuts if user is typing
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
                case 'KeyR':
                    if (e.metaKey || e.ctrlKey) return; // Don't override browser refresh
                    e.preventDefault();
                    this.refreshPlaylist();
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
            
            this.renderPlaylist();
            
            if (this.tracks.length > 0) {
                this.loadTrack(0);
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
        this.updatePlaylist();
        
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
     * Render the playlist
     */
    renderPlaylist() {
        if (!this.elements.playlist) return;
        
        if (this.tracks.length === 0) {
            this.showEmptyState();
            return;
        }
        
        const playlistHTML = this.tracks.map((track, index) => `
            <div class="track-item ${index === this.currentIndex ? 'active' : ''}" 
                 data-index="${index}">
                <div class="track-number">${index + 1}</div>
                <div class="track-details">
                    <div class="track-name">${this.escapeHtml(track.title)}</div>
                    <div class="track-meta">mentria.ai • Copyright-free</div>
                </div>
            </div>
        `).join('');
        
        this.elements.playlist.innerHTML = playlistHTML;
        
        // Add click listeners to track items
        this.elements.playlist.querySelectorAll('.track-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.loadTrack(index);
            });
        });
    }
    
    /**
     * Update playlist active state
     */
    updatePlaylist() {
        if (!this.elements.playlist) return;
        
        this.elements.playlist.querySelectorAll('.track-item').forEach((item, index) => {
            item.classList.toggle('active', index === this.currentIndex);
        });
    }
    
    /**
     * Show empty state
     */
    showEmptyState(message = null) {
        if (!this.elements.playlist) return;
        
        const emptyStateHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎵</div>
                <div class="empty-state-title">No tracks available</div>
                <div class="empty-state-description">
                    ${message || 'Generate music using the OctoBeats workflow to see tracks here.'}
                </div>
            </div>
        `;
        
        this.elements.playlist.innerHTML = emptyStateHTML;
        
        // Hide download button
        if (this.elements.downloadButton) {
            this.elements.downloadButton.style.display = 'none';
        }
        
        // Update track info
        if (this.elements.trackTitle) {
            this.elements.trackTitle.textContent = 'No tracks available';
        }
        if (this.elements.trackArtist) {
            this.elements.trackArtist.textContent = 'Generate music to get started';
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
     * Refresh playlist
     */
    async refreshPlaylist() {
        await this.loadTracks();
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
        
        if (this.elements.refreshButton) {
            if (loading) {
                this.elements.refreshButton.innerHTML = '<div class="loading-spinner"></div>';
                this.elements.refreshButton.disabled = true;
            } else {
                this.elements.refreshButton.innerHTML = '↻';
                this.elements.refreshButton.disabled = false;
            }
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
        
        if (this.elements.progressHandle) {
            this.elements.progressHandle.style.left = `${percent}%`;
        }
        
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = this.formatTime(this.audio.currentTime);
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
    }
    
    onTimeUpdate() {
        this.updateProgress();
    }
    
    onEnded() {
        this.nextTrack();
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