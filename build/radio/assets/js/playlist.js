/**
 * Playlist - Manages audio tracks and playlist functionality
 */
class Playlist {
    constructor() {
        this.tracks = [];
        this.currentIndex = 0;
        this.isShuffled = false;
        this.shuffledIndices = [];
        this.playlistElement = document.getElementById('playlist');
        this.refreshBtn = document.getElementById('refreshBtn');
        
        this.bindEvents();
        this.loadTracks();
    }
    
    bindEvents() {
        // Refresh button
        this.refreshBtn.addEventListener('click', () => this.refreshPlaylist());
        
        // Auto-refresh every 30 seconds to catch new tracks
        setInterval(() => this.loadTracks(true), 30000);
    }
    
    async loadTracks(silent = false) {
        if (!silent) {
            this.showLoading(true);
        }
        
        try {
            // Try to load tracks from the audios directory
            const tracks = await this.scanAudioDirectory();
            
            if (tracks.length > 0) {
                this.tracks = tracks;
                this.renderPlaylist();
                this.hideEmptyState();
            } else {
                this.showEmptyState();
            }
            
            if (!silent) {
                this.showLoading(false);
            }
        } catch (error) {
            console.error('Error loading tracks:', error);
            if (!silent) {
                this.showError('Failed to load tracks');
                this.showLoading(false);
            }
        }
    }
    
    async scanAudioDirectory() {
        const tracks = [];
        
        try {
            // Try to fetch a directory listing or known files
            // Since we can't directly list directory contents in a browser,
            // we'll try to load known patterns or use a manifest file
            
            // First, try to load a manifest file if it exists
            const manifest = await this.loadManifest();
            if (manifest && manifest.length > 0) {
                return manifest;
            }
            
            // Fallback: try common file patterns
            const patterns = await this.tryCommonPatterns();
            return patterns;
            
        } catch (error) {
            console.warn('Could not scan audio directory:', error);
            return [];
        }
    }
    
    async loadManifest() {
        try {
            const response = await fetch('assets/audios/manifest.json');
            if (response.ok) {
                const manifest = await response.json();
                return manifest.tracks || [];
            }
        } catch (error) {
            // Manifest doesn't exist, that's okay
        }
        return null;
    }
    
    async tryCommonPatterns() {
        const tracks = [];
        const baseUrl = 'assets/audios/';
        
        // Try to load files based on OctoBeats naming pattern
        // audio_issue_XX_YYYYMMDD_HHMMSS.mp3
        for (let i = 1; i <= 50; i++) {
            try {
                const audioFile = `audio_issue_${i}_*.mp3`;
                const metadataFile = `audio_issue_${i}_*_metadata.json`;
                
                // Since we can't use wildcards, we'll try to find existing files
                // by checking if they exist
                const track = await this.tryLoadTrack(i);
                if (track) {
                    tracks.push(track);
                }
            } catch (error) {
                // File doesn't exist, continue
                break;
            }
        }
        
        return tracks;
    }
    
    async tryLoadTrack(issueNumber) {
        const baseUrl = 'assets/audios/';
        
        try {
            // Try to find files for this issue number
            // We'll use a more direct approach by checking known file patterns
            const possibleFiles = await this.findFilesForIssue(issueNumber);
            
            if (possibleFiles.audio && possibleFiles.metadata) {
                const metadata = await this.loadMetadata(possibleFiles.metadata);
                
                return {
                    id: `issue_${issueNumber}`,
                    title: this.generateTitle(metadata),
                    artist: 'OctoBeats Studio',
                    file: possibleFiles.audio,
                    metadata: metadata,
                    duration: metadata.duration || 0,
                    issueNumber: issueNumber
                };
            }
        } catch (error) {
            // File doesn't exist
        }
        
        return null;
    }
    
    async findFilesForIssue(issueNumber) {
        // Since we can't list directory contents, we'll try to access files directly
        // and see if they exist by attempting to fetch them
        
        const baseUrl = 'assets/audios/';
        const patterns = [
            // Try different timestamp patterns
            `audio_issue_${issueNumber}_`,
        ];
        
        // For now, we'll create a simple approach
        // In a real implementation, you'd have a server endpoint that lists files
        // or generate a manifest file during the build process
        
        // Try to load from a known location or use a service worker to intercept requests
        const audioFile = `${baseUrl}audio_issue_${issueNumber}.mp3`;
        const metadataFile = `${baseUrl}audio_issue_${issueNumber}_metadata.json`;
        
        try {
            // Check if files exist by making HEAD requests
            const audioResponse = await fetch(audioFile, { method: 'HEAD' });
            const metadataResponse = await fetch(metadataFile, { method: 'HEAD' });
            
            if (audioResponse.ok && metadataResponse.ok) {
                return {
                    audio: audioFile,
                    metadata: metadataFile
                };
            }
        } catch (error) {
            // Files don't exist
        }
        
        return null;
    }
    
    async loadMetadata(metadataUrl) {
        try {
            const response = await fetch(metadataUrl);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.warn('Could not load metadata:', error);
        }
        
        return {};
    }
    
    generateTitle(metadata) {
        if (metadata.issue_title) {
            // Clean up the title
            return metadata.issue_title.replace(/^\[MUSIC\]\s*/, '').trim() || 'Generated Track';
        }
        
        if (metadata.parameters && metadata.parameters.prompt) {
            // Use the prompt as title
            const prompt = metadata.parameters.prompt;
            return prompt.split(',')[0].trim() || 'Generated Track';
        }
        
        return 'Generated Track';
    }
    
    renderPlaylist() {
        if (this.tracks.length === 0) {
            this.showEmptyState();
            return;
        }
        
        const playlistHtml = this.tracks.map((track, index) => `
            <div class="track-item" data-index="${index}" data-track-id="${track.id}">
                <div class="track-number">${index + 1}</div>
                <div class="track-details">
                    <div class="track-name">${this.escapeHtml(track.title)}</div>
                    <div class="track-info-small">
                        ${track.metadata.parameters ? this.escapeHtml(track.metadata.parameters.prompt || '') : ''}
                    </div>
                </div>
                <div class="track-duration">${this.formatDuration(track.duration)}</div>
            </div>
        `).join('');
        
        this.playlistElement.innerHTML = playlistHtml;
        
        // Bind click events
        this.playlistElement.querySelectorAll('.track-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.playTrack(index);
            });
        });
        
        // Update active track
        this.updateActiveTrack();
    }
    
    showEmptyState() {
        this.playlistElement.innerHTML = `
            <div class="empty-playlist">
                <i class="fas fa-music"></i>
                <p>No tracks available</p>
                <small>Generate music using OctoBeats to see tracks here</small>
            </div>
        `;
    }
    
    hideEmptyState() {
        const emptyState = this.playlistElement.querySelector('.empty-playlist');
        if (emptyState) {
            emptyState.remove();
        }
    }
    
    async playTrack(index) {
        if (index < 0 || index >= this.tracks.length) return;
        
        this.currentIndex = index;
        const track = this.tracks[index];
        
        if (window.audioEngine) {
            const loaded = await window.audioEngine.loadTrack(track);
            if (loaded) {
                await window.audioEngine.play();
                this.updateActiveTrack();
            }
        }
    }
    
    nextTrack() {
        if (this.tracks.length === 0) return;
        
        let nextIndex;
        
        if (this.isShuffled) {
            const currentShuffledIndex = this.shuffledIndices.indexOf(this.currentIndex);
            const nextShuffledIndex = (currentShuffledIndex + 1) % this.shuffledIndices.length;
            nextIndex = this.shuffledIndices[nextShuffledIndex];
        } else {
            nextIndex = (this.currentIndex + 1) % this.tracks.length;
        }
        
        this.playTrack(nextIndex);
    }
    
    previousTrack() {
        if (this.tracks.length === 0) return;
        
        let prevIndex;
        
        if (this.isShuffled) {
            const currentShuffledIndex = this.shuffledIndices.indexOf(this.currentIndex);
            const prevShuffledIndex = currentShuffledIndex === 0 
                ? this.shuffledIndices.length - 1 
                : currentShuffledIndex - 1;
            prevIndex = this.shuffledIndices[prevShuffledIndex];
        } else {
            prevIndex = this.currentIndex === 0 
                ? this.tracks.length - 1 
                : this.currentIndex - 1;
        }
        
        this.playTrack(prevIndex);
    }
    
    setShuffle(enabled) {
        this.isShuffled = enabled;
        
        if (enabled) {
            // Create shuffled indices array
            this.shuffledIndices = [...Array(this.tracks.length).keys()];
            this.shuffleArray(this.shuffledIndices);
            
            // Make sure current track is first in shuffle
            const currentShuffledIndex = this.shuffledIndices.indexOf(this.currentIndex);
            if (currentShuffledIndex > 0) {
                [this.shuffledIndices[0], this.shuffledIndices[currentShuffledIndex]] = 
                [this.shuffledIndices[currentShuffledIndex], this.shuffledIndices[0]];
            }
        }
    }
    
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
    
    updateActiveTrack() {
        // Remove active class from all tracks
        this.playlistElement.querySelectorAll('.track-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Add active class to current track
        const activeTrack = this.playlistElement.querySelector(`[data-index="${this.currentIndex}"]`);
        if (activeTrack) {
            activeTrack.classList.add('active');
            
            // Scroll into view if needed
            activeTrack.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'nearest' 
            });
        }
    }
    
    refreshPlaylist() {
        this.refreshBtn.querySelector('i').style.transform = 'rotate(180deg)';
        this.loadTracks();
        
        setTimeout(() => {
            this.refreshBtn.querySelector('i').style.transform = 'rotate(0deg)';
        }, 500);
    }
    
    // Utility methods
    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '--:--';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showLoading(show) {
        if (window.audioEngine) {
            window.audioEngine.showLoading(show);
        }
    }
    
    showError(message) {
        if (window.audioEngine) {
            window.audioEngine.showError(message);
        }
    }
    
    // Public API
    getTracks() {
        return this.tracks;
    }
    
    getCurrentTrack() {
        return this.tracks[this.currentIndex];
    }
    
    getCurrentIndex() {
        return this.currentIndex;
    }
    
    getTrackCount() {
        return this.tracks.length;
    }
}

// Initialize playlist when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.playlist = new Playlist();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Playlist;
} 