// Only initialize if not already initialized
if (typeof window.postsInitialized === 'undefined') {
    window.postsInitialized = true;

    let currentPage = 0;
    const postsPerPage = 10;
    let isLoading = false;
    let hasMorePosts = true;
    let allPosts = [];
    let userHasUnmuted = false;
    let scrollTimeout = null;
    let scrollDebounceTimeout = null;
    let videoObservers = new Map();
    let isScrolling = false;

    // Safe markdown parsing function
    function parseMarkdown(text) {
        if (typeof marked === 'undefined') {
            return text;
        }
        try {
            return marked.parse(text);
        } catch (error) {
            return text;
        }
    }

    async function fetchPostsIndex() {
        if (isLoading || !hasMorePosts) return;
        isLoading = true;
        
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.classList.add('visible');
        }
        
        try {
            // Fetch posts index if not already loaded
            if (allPosts.length === 0) {
                const response = await fetch('/api/posts_index.json');
                if (!response.ok) return;
                
                const data = await response.json();
                if (data.data && data.data.posts) {
                    allPosts = data.data.posts;
                }
            }
            
            // Get next batch of posts
            const startIndex = currentPage * postsPerPage;
            const endIndex = startIndex + postsPerPage;
            const postsToLoad = allPosts.slice(startIndex, endIndex);
            
            if (postsToLoad.length === 0) {
                hasMorePosts = false;
                return;
            }
            
            // Fetch and render each post
            await Promise.all(postsToLoad.map(fetchAndRenderPost));
            currentPage++;
            
        } catch (error) {
            showError('Failed to load posts. Please try again later.');
        } finally {
            isLoading = false;
            if (loadingIndicator) {
                loadingIndicator.classList.remove('visible');
            }
        }
    }

    async function fetchAndRenderPost(postInfo) {
        try {
            const jsonUrl = postInfo.json_url;
            const response = await fetch(jsonUrl);
            if (!response.ok) return;
            
            const post = await response.json();
            renderPost(post, postInfo.post_url);
        } catch (error) {
            // Silently skip failed posts
            return;
        }
    }

    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        
        const container = document.getElementById('posts-container');
        container.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }

    function handleVideoIntersection(entries, observer) {
        entries.forEach(entry => {
            const video = entry.target;
            if (!video) return;

            const isFullyInView = entry.intersectionRatio >= 0.7;

            if (entry.isIntersecting && isFullyInView) {
                // Pause all other playing videos first
                document.querySelectorAll('.post-video').forEach(v => {
                    if (v !== video && !v.paused) {
                        pauseVideo(v);
                    }
                });

                // Only play if video is ready and not already playing
                if (video.readyState >= 2 && video.paused) {
                    playVideo(video).catch(() => {
                        // If playback fails, try again with muted
                        video.muted = true;
                        playVideo(video).catch(() => {
                            console.warn('Video playback failed:', video.src);
                        });
                    });
                } else if (video.readyState < 2) {
                    // Wait for video to be ready
                    const playWhenReady = () => {
                        if (isElementInViewport(video)) {
                            playVideo(video).catch(() => {
                                video.muted = true;
                                playVideo(video).catch(() => {
                                    console.warn('Video playback failed:', video.src);
                                });
                            });
                        }
                        video.removeEventListener('canplay', playWhenReady);
                    };
                    video.addEventListener('canplay', playWhenReady);
                }
            } else if (!entry.isIntersecting && !video.paused) {
                pauseVideo(video);
            }
        });
    }

    async function playVideo(video) {
        if (!video.paused) return;
        
        video.muted = !userHasUnmuted;
        if (video.ended) video.currentTime = 0;
        
        try {
            // Ensure video is properly loaded before attempting to play
            if (video.readyState < 2) {
                await new Promise((resolve, reject) => {
                    video.addEventListener('loadeddata', resolve, { once: true });
                    video.addEventListener('error', reject, { once: true });
                    // Set a timeout to avoid hanging
                    setTimeout(reject, 5000);
                });
            }
            
            await video.play();
        } catch (error) {
            console.warn('Error playing video:', error);
            if (!video.muted) {
                video.muted = true;
                try {
                    await video.play();
                } catch (mutedError) {
                    console.error('Failed to play even with muted:', mutedError);
                }
            }
        }
    }

    async function pauseVideo(video) {
        if (video.paused) return;
        
        try {
            await video.pause();
            if (video.ended) video.currentTime = 0;
        } catch (error) {
            console.warn('Error pausing video:', error);
        }
    }

    function isElementInViewport(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    function toggleMute(video, muteButton) {
        video.muted = !video.muted;
        userHasUnmuted = !video.muted;
        muteButton.innerHTML = video.muted ? 
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
        
        // Update all other videos' mute state
        document.querySelectorAll('.post-video').forEach(v => {
            if (v !== video) {
                v.muted = video.muted;
                const btn = v.parentElement.querySelector('.mute-button');
                if (btn) btn.innerHTML = muteButton.innerHTML;
            }
        });
    }

    function renderPost(post, postUrl) {
        const container = document.getElementById('posts-container');
        
        const article = document.createElement('article');
        article.className = 'post-preview animate-entry';
        article.dataset.postId = post.id;
        
        let mediaContent = '';
        if (post.type === 'Photo') {
            mediaContent = `
                <div class="media-container">
                    <img src="${post.images.image700.url}" alt="${post.title}" class="post-image" loading="lazy">
                </div>`;
        } else if (post.type === 'Animated' && post.images.image460sv?.url) {
            mediaContent = `
                <div class="media-container">
                    <video class="post-video" playsinline loop muted preload="auto" poster="${post.images.image460.url}"
                           x-webkit-airplay="allow" data-setup='{"fluid": true}'>
                        <source src="${post.images.image460sv.url}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                    <button class="mute-button" aria-label="Toggle sound">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                            <line x1="23" y1="9" x2="17" y2="15"></line>
                            <line x1="17" y1="9" x2="23" y2="15"></line>
                        </svg>
                    </button>
                </div>`;
        }

        // Calculate vote ratio
        const totalVotes = post.upVoteCount + post.downVoteCount;
        const upvoteRatio = totalVotes > 0 ? (post.upVoteCount / totalVotes) * 100 : 50;
        
        article.innerHTML = `
            <h2 class="post-title">
                <a href="${postUrl}" class="post-link">${post.title}</a>
            </h2>
            <div class="post-content">
                ${mediaContent}
                ${post.description ? `<div class="post-description">${parseMarkdown(post.description)}</div>` : ''}
            </div>
            <div class="post-meta">
                <div class="post-stats">
                    <span class="stat upvotes" title="Upvotes">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                        </svg>
                        ${formatNumber(post.upVoteCount)}
                    </span>
                    <span class="stat downvotes" title="Downvotes">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
                        </svg>
                        ${formatNumber(post.downVoteCount)}
                    </span>
                    <span class="stat comments" title="Comments">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                        </svg>
                        ${formatNumber(post.commentsCount)}
                    </span>
                    <div class="vote-ratio" style="--ratio: ${upvoteRatio}%"></div>
                </div>
            </div>
        `;
        
        // Set the width of the vote ratio bar after the element is added to the DOM
        requestAnimationFrame(() => {
            const ratioBar = article.querySelector('.vote-ratio::after');
            if (ratioBar) {
                ratioBar.style.width = `${upvoteRatio}%`;
            }
        });
        
        container.appendChild(article);

        // Set up video intersection observer and mute button handlers
        const video = article.querySelector('.post-video');
        if (video) {
            // Enhanced video attributes for better mobile support
            video.playsInline = true;
            video.muted = !userHasUnmuted;
            video.loop = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            video.setAttribute('x-webkit-airplay', 'allow');
            
            // Add loading event listeners
            video.addEventListener('loadstart', () => console.log('Video loading started:', video.src));
            video.addEventListener('loadeddata', () => console.log('Video data loaded:', video.src));
            video.addEventListener('error', (e) => {
                console.error('Video loading error:', {
                    src: video.src,
                    error: e.target.error,
                    networkState: video.networkState,
                    readyState: video.readyState
                });
            });
            
            // Create a new observer for each video
            const observer = new IntersectionObserver(handleVideoIntersection, {
                threshold: [0, 0.7],
                rootMargin: '0px'
            });
            
            // Store observer reference for cleanup
            videoObservers.set(video, observer);
            observer.observe(video);
            
            const muteButton = article.querySelector('.mute-button');
            if (muteButton) {
                muteButton.addEventListener('click', () => toggleMute(video, muteButton));
            }
            
            // Set initial mute state based on user preference
            video.muted = !userHasUnmuted;
            if (muteButton) {
                muteButton.innerHTML = video.muted ? 
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>' :
                    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
            }
        }
        
        // If this is the last post and there are no more posts
        if (!hasMorePosts && article.dataset.postId === allPosts[allPosts.length - 1].id) {
            const endMessage = document.createElement('div');
            endMessage.className = 'end-message';
            endMessage.textContent = 'No more posts to load';
            container.appendChild(endMessage);
        }
    }

    function formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }

    // Initialize intersection observer for videos
    const videoObserverOptions = {
        root: null,
        rootMargin: '0px',
        threshold: [0, 0.25, 0.5, 0.75, 1.0] // More granular thresholds for better tracking
    };

    function setupVideoObservers() {
        const videos = document.querySelectorAll('.post-video');
        videos.forEach(video => {
            if (!videoObservers.has(video)) {
                const observer = new IntersectionObserver(handleVideoIntersection, videoObserverOptions);
                observer.observe(video);
                videoObservers.set(video, observer);
                
                // Add error handling for video loading
                video.addEventListener('error', (e) => {
                    console.warn('Video loading error:', e.target.src, e.target.error);
                });
                
                // Ensure video is ready for playback
                if (video.readyState >= 2) {
                    video.setAttribute('playsinline', '');
                    video.setAttribute('webkit-playsinline', '');
                }
            }
        });
    }

    // Clean up observers for removed videos
    function cleanupVideoObservers() {
        videoObservers.forEach((observer, video) => {
            if (!document.body.contains(video)) {
                observer.disconnect();
                videoObservers.delete(video);
            }
        });
    }

    // Update observers when new content is loaded
    const postsContainer = document.getElementById('posts-container');
    if (postsContainer) {
        const postsObserver = new MutationObserver(() => {
            setupVideoObservers();
            cleanupVideoObservers();
        });
        
        postsObserver.observe(postsContainer, {
            childList: true,
            subtree: true
        });
    }

    // Initial setup
    setupVideoObservers();

    // Handle scroll events
    window.addEventListener('scroll', () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        
        if (!isScrolling) {
            isScrolling = true;
        }
        
        scrollTimeout = setTimeout(() => {
            isScrolling = false;
            setupVideoObservers();
        }, 150);
        
        // Debounced infinite scroll check
        if (scrollDebounceTimeout) {
            clearTimeout(scrollDebounceTimeout);
        }
        
        scrollDebounceTimeout = setTimeout(() => {
            const scrollPosition = window.innerHeight + window.scrollY;
            const pageHeight = document.documentElement.scrollHeight;
            
            if (scrollPosition >= pageHeight - 1000) {
                fetchPostsIndex();
            }
        }, 100);
    });

    // Initial load
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof marked === 'undefined') {
            setTimeout(fetchPostsIndex, 500);
        } else {
            fetchPostsIndex();
        }
    });
} 