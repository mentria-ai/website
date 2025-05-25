/**
 * Audio Engine - Handles audio playback and controls
 */
class AudioEngine {
    constructor() {
        this.audio = document.getElementById('audioPlayer');
        this.currentTrack = null;
        this.isPlaying = false;
        this.volume = 0.7;
        this.isMuted = false;
        this.previousVolume = this.volume;
        this.isShuffled = false;
        this.repeatMode = 'none'; // 'none', 'one', 'all'
        this.currentTime = 0;
        this.duration = 0;
        
        this.initializeAudio();
        this.bindEvents();
    }
    
    initializeAudio() {
        this.audio.volume = this.volume;
        this.audio.preload = 'metadata';
        
        // Set initial volume
        this.updateVolumeDisplay();
    }
    
    bindEvents() {
        // Audio events
        this.audio.addEventListener('loadstart', () => this.onLoadStart());
        this.audio.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
        this.audio.addEventListener('canplay', () => this.onCanPlay());
        this.audio.addEventListener('play', () => this.onPlay());
        this.audio.addEventListener('pause', () => this.onPause());
        this.audio.addEventListener('ended', () => this.onEnded());
        this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
        this.audio.addEventListener('error', (e) => this.onError(e));
        this.audio.addEventListener('waiting', () => this.onWaiting());
        this.audio.addEventListener('playing', () => this.onPlaying());
        
        // Progress bar events
        const progressBar = document.getElementById('progressBar');
        progressBar.addEventListener('click', (e) => this.seekTo(e));
        progressBar.addEventListener('mousedown', () => this.startSeeking());
        progressBar.addEventListener('mouseup', () => this.stopSeeking());
        
        // Volume events
        const volumeSlider = document.getElementById('volumeSlider');
        volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value / 100));
        
        const volumeBtn = document.getElementById('volumeBtn');
        volumeBtn.addEventListener('click', () => this.toggleMute());
        
        // Control button events
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('nextBtn').addEventListener('click', () => this.nextTrack());
        document.getElementById('prevBtn').addEventListener('click', () => this.previousTrack());
        document.getElementById('shuffleBtn').addEventListener('click', () => this.toggleShuffle());
        document.getElementById('repeatBtn').addEventListener('click', () => this.toggleRepeat());
    }
    
    // Audio event handlers
    onLoadStart() {
        this.updateStatus('Loading...');
        this.showLoading(true);
    }
    
    onLoadedMetadata() {
        this.duration = this.audio.duration;
        this.updateTimeDisplay();
        this.updateStatus('Ready');
    }
    
    onCanPlay() {
        this.showLoading(false);
        this.updateStatus('Ready');
    }
    
    onPlay() {
        this.isPlaying = true;
        this.updatePlayButton();
        this.updateStatus('Playing');
        
        // Start equalizer animation
        if (window.equalizer) {
            window.equalizer.start();
        }
    }
    
    onPause() {
        this.isPlaying = false;
        this.updatePlayButton();
        this.updateStatus('Paused');
        
        // Stop equalizer animation
        if (window.equalizer) {
            window.equalizer.stop();
        }
    }
    
    onEnded() {
        this.isPlaying = false;
        this.updatePlayButton();
        this.updateStatus('Ready');
        
        // Stop equalizer animation
        if (window.equalizer) {
            window.equalizer.stop();
        }
        
        // Handle repeat and next track
        if (this.repeatMode === 'one') {
            this.play();
        } else if (this.repeatMode === 'all' || this.isShuffled) {
            this.nextTrack();
        }
    }
    
    onTimeUpdate() {
        if (!this.isSeeking) {
            this.currentTime = this.audio.currentTime;
            this.updateProgress();
            this.updateTimeDisplay();
        }
    }
    
    onError(e) {
        console.error('Audio error:', e);
        this.showError('Failed to load audio file');
        this.showLoading(false);
        this.updateStatus('Error');
    }
    
    onWaiting() {
        this.updateStatus('Buffering...');
    }
    
    onPlaying() {
        this.updateStatus('Playing');
    }
    
    // Playback controls
    async loadTrack(track) {
        if (!track || !track.file) {
            this.showError('Invalid track data');
            return false;
        }
        
        try {
            this.currentTrack = track;
            this.audio.src = track.file;
            
            // Update track info display
            this.updateTrackInfo(track);
            
            // Reset progress
            this.currentTime = 0;
            this.updateProgress();
            this.updateTimeDisplay();
            
            // Reconnect equalizer to new audio source
            if (window.equalizer && !window.equalizer.source) {
                window.equalizer.connectToAudio();
            }
            
            return true;
        } catch (error) {
            console.error('Error loading track:', error);
            this.showError('Failed to load track');
            return false;
        }
    }
    
    async play() {
        if (!this.audio.src) {
            this.showError('No track loaded');
            return;
        }
        
        try {
            // Ensure equalizer is connected before playing
            if (window.equalizer && !window.equalizer.source) {
                window.equalizer.connectToAudio();
            }
            
            await this.audio.play();
        } catch (error) {
            console.error('Error playing audio:', error);
            this.showError('Failed to play audio');
        }
    }
    
    pause() {
        this.audio.pause();
    }
    
    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    stop() {
        this.pause();
        this.audio.currentTime = 0;
        this.currentTime = 0;
        this.updateProgress();
        this.updateTimeDisplay();
    }
    
    // Seeking
    seekTo(event) {
        if (!this.duration) return;
        
        const progressBar = event.currentTarget;
        const rect = progressBar.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        const time = percent * this.duration;
        
        this.audio.currentTime = time;
        this.currentTime = time;
        this.updateProgress();
        this.updateTimeDisplay();
    }
    
    startSeeking() {
        this.isSeeking = true;
    }
    
    stopSeeking() {
        this.isSeeking = false;
    }
    
    // Volume controls
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.audio.volume = this.volume;
        this.updateVolumeDisplay();
        
        // Update mute state
        if (this.volume === 0) {
            this.isMuted = true;
        } else {
            this.isMuted = false;
        }
        this.updateVolumeButton();
    }
    
    toggleMute() {
        if (this.isMuted) {
            this.setVolume(this.previousVolume);
            this.isMuted = false;
        } else {
            this.previousVolume = this.volume;
            this.setVolume(0);
            this.isMuted = true;
        }
        this.updateVolumeButton();
    }
    
    // Playlist controls
    nextTrack() {
        if (window.playlist) {
            window.playlist.nextTrack();
        }
    }
    
    previousTrack() {
        if (window.playlist) {
            window.playlist.previousTrack();
        }
    }
    
    toggleShuffle() {
        this.isShuffled = !this.isShuffled;
        this.updateShuffleButton();
        
        if (window.playlist) {
            window.playlist.setShuffle(this.isShuffled);
        }
    }
    
    toggleRepeat() {
        const modes = ['none', 'all', 'one'];
        const currentIndex = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(currentIndex + 1) % modes.length];
        this.updateRepeatButton();
    }
    
    // UI Updates
    updatePlayButton() {
        const playBtn = document.getElementById('playPauseBtn');
        const icon = playBtn.querySelector('i');
        
        if (this.isPlaying) {
            icon.className = 'fas fa-pause';
            playBtn.title = 'Pause';
        } else {
            icon.className = 'fas fa-play';
            playBtn.title = 'Play';
        }
    }
    
    updateProgress() {
        if (!this.duration) return;
        
        const percent = (this.currentTime / this.duration) * 100;
        const progressFill = document.getElementById('progressFill');
        const progressHandle = document.getElementById('progressHandle');
        
        progressFill.style.width = `${percent}%`;
        progressHandle.style.left = `${percent}%`;
    }
    
    updateTimeDisplay() {
        const currentTimeEl = document.getElementById('currentTime');
        const totalTimeEl = document.getElementById('totalTime');
        
        currentTimeEl.textContent = this.formatTime(this.currentTime);
        totalTimeEl.textContent = this.formatTime(this.duration);
    }
    
    updateTrackInfo(track) {
        const titleEl = document.getElementById('trackTitle');
        const artistEl = document.getElementById('trackArtist');
        const metadataEl = document.getElementById('trackMetadata');
        
        titleEl.textContent = track.title || 'Unknown Track';
        artistEl.textContent = track.artist || 'mentria.ai';
        
        // Show metadata if available
        if (track.metadata) {
            const meta = track.metadata;
            const metaText = [];
            
            if (meta.mode) metaText.push(`Quality: ${meta.mode}`);
            if (meta.duration) metaText.push(`Duration: ${meta.duration}s`);
            if (meta.generated_at) {
                const date = new Date(meta.generated_at);
                metaText.push(`Generated: ${date.toLocaleDateString()}`);
            }
            
            metadataEl.textContent = metaText.join(' • ');
        } else {
            metadataEl.textContent = '';
        }
    }
    
    updateVolumeDisplay() {
        const volumeSlider = document.getElementById('volumeSlider');
        volumeSlider.value = this.volume * 100;
    }
    
    updateVolumeButton() {
        const volumeBtn = document.getElementById('volumeBtn');
        const icon = volumeBtn.querySelector('i');
        
        if (this.isMuted || this.volume === 0) {
            icon.className = 'fas fa-volume-mute';
        } else if (this.volume < 0.5) {
            icon.className = 'fas fa-volume-down';
        } else {
            icon.className = 'fas fa-volume-up';
        }
    }
    
    updateShuffleButton() {
        const shuffleBtn = document.getElementById('shuffleBtn');
        shuffleBtn.classList.toggle('active', this.isShuffled);
    }
    
    updateRepeatButton() {
        const repeatBtn = document.getElementById('repeatBtn');
        const icon = repeatBtn.querySelector('i');
        
        repeatBtn.classList.remove('active');
        
        switch (this.repeatMode) {
            case 'none':
                icon.className = 'fas fa-redo';
                break;
            case 'all':
                icon.className = 'fas fa-redo';
                repeatBtn.classList.add('active');
                break;
            case 'one':
                icon.className = 'fas fa-redo-alt';
                repeatBtn.classList.add('active');
                break;
        }
    }
    
    updateStatus(status) {
        const statusText = document.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = status;
        }
    }
    
    // Utility methods
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    showLoading(show) {
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.toggle('active', show);
    }
    
    showError(message) {
        const errorToast = document.getElementById('errorToast');
        const errorMessage = document.getElementById('errorMessage');
        
        errorMessage.textContent = message;
        errorToast.classList.add('active');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            errorToast.classList.remove('active');
        }, 5000);
    }
    
    // Public API
    getCurrentTrack() {
        return this.currentTrack;
    }
    
    getIsPlaying() {
        return this.isPlaying;
    }
    
    getCurrentTime() {
        return this.currentTime;
    }
    
    getDuration() {
        return this.duration;
    }
    
    getVolume() {
        return this.volume;
    }
    
    getRepeatMode() {
        return this.repeatMode;
    }
    
    getIsShuffled() {
        return this.isShuffled;
    }
}

// Initialize audio engine when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.audioEngine = new AudioEngine();
    
    // Close error toast
    document.getElementById('closeToast').addEventListener('click', () => {
        document.getElementById('errorToast').classList.remove('active');
    });
}); 