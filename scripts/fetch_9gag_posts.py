import requests
import json
import os
from datetime import datetime
import time
import random
import mimetypes
from urllib.parse import urlparse

# Headers to mimic a browser request
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://9gag.com',
    'Referer': 'https://9gag.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
}

def sanitize_url(url):
    """Convert 9gag URLs to our native URLs"""
    if not url:
        return url
    parsed = urlparse(url)
    # Keep only the path and query parts
    return parsed.path + ('?' + parsed.query if parsed.query else '')

def verify_video_file(filename):
    """Verify video file by checking its header"""
    try:
        with open(filename, 'rb') as f:
            # Read first 128 bytes to check for common video signatures
            header = f.read(128)
            
            # Check for common MP4 signatures anywhere in the header
            if (b'ftyp' in header or  # Standard MP4
                b'moov' in header or  # QuickTime MOV
                b'mdat' in header or  # MP4 data
                b'free' in header):   # Another common MP4 box
                return True
            return False
    except Exception as e:
        print(f"Error verifying video file: {e}")
        return False

def download_media(url, post_id, media_type):
    """Download media file and return local path"""
    if not url:
        return None
        
    # Create media directories if they don't exist
    media_dir = "assets/media"
    os.makedirs(media_dir, exist_ok=True)
    
    # Get file extension from URL or default to .jpg/.mp4
    parsed_url = urlparse(url)
    path = parsed_url.path
    ext = os.path.splitext(path)[1]
    if not ext:
        ext = '.mp4' if media_type == 'video' else '.jpg'
    
    # Create local filename
    local_filename = f"{media_dir}/{post_id}{ext}"
    temp_filename = f"{local_filename}.temp"
    
    try:
        # Make a HEAD request to get content length and actual ETag
        head_response = requests.head(url, headers=HEADERS, allow_redirects=True)
        head_response.raise_for_status()
        expected_size = int(head_response.headers.get('content-length', 0))
        server_etag = head_response.headers.get('etag')
        
        # Check if we have a complete file
        if os.path.exists(local_filename):
            local_size = os.path.getsize(local_filename)
            if local_size == expected_size:
                # For videos, also verify the file integrity
                if media_type == 'video':
                    if verify_video_file(local_filename):
                        print(f"Using existing verified video: {local_filename}")
                        return f"/{local_filename}"
                else:
                    print(f"Using existing complete file: {local_filename}")
                    return f"/{local_filename}"
        
        # Start the download
        response = requests.get(url, headers=HEADERS, stream=True)
        response.raise_for_status()
        
        downloaded_size = 0
        with open(temp_filename, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
        
        # Verify downloaded file size
        if expected_size > 0:
            actual_size = os.path.getsize(temp_filename)
            if abs(actual_size - expected_size) > 1024:  # Allow 1KB difference
                print(f"Size mismatch for {post_id}: expected {expected_size}, got {actual_size}")
                if os.path.exists(temp_filename):
                    os.remove(temp_filename)
                return url
        
        # For videos, verify the file integrity
        if media_type == 'video':
            if not verify_video_file(temp_filename):
                print(f"Invalid video file for {post_id}")
                if os.path.exists(temp_filename):
                    os.remove(temp_filename)
                return url
        
        # If all checks pass, move temp file to final location
        if os.path.exists(local_filename):
            os.remove(local_filename)
        os.rename(temp_filename, local_filename)
        print(f"Successfully downloaded {media_type}: {local_filename}")
        
    except Exception as e:
        print(f"Error downloading {media_type} for {post_id}: {e}")
        if os.path.exists(temp_filename):
            os.remove(temp_filename)
        return url
        
    return f"/{local_filename}"  # Return local path

def download_post_media(post):
    """Download all media for a post and update URLs"""
    if post['type'] == 'Photo':
        if 'image700' in post['images']:
            post['images']['image700']['url'] = download_media(
                post['images']['image700']['url'],
                f"{post['id']}_image700",
                'image'
            )
        if 'image460' in post['images']:
            post['images']['image460']['url'] = download_media(
                post['images']['image460']['url'],
                f"{post['id']}_image460",
                'image'
            )
            
    elif post['type'] == 'Animated':
        if 'image700' in post['images']:
            post['images']['image700']['url'] = download_media(
                post['images']['image700']['url'],
                f"{post['id']}_image700",
                'image'
            )
        if 'image460' in post['images']:
            post['images']['image460']['url'] = download_media(
                post['images']['image460']['url'],
                f"{post['id']}_image460",
                'image'
            )
        if 'image460sv' in post['images']:
            post['images']['image460sv']['url'] = download_media(
                post['images']['image460sv']['url'],
                f"{post['id']}_video",
                'video'
            )
    
    return post

def get_existing_posts():
    """Get a set of already fetched post IDs"""
    existing_posts = set()
    posts_dir = "_posts"
    
    if os.path.exists(posts_dir):
        for filename in os.listdir(posts_dir):
            if filename.endswith('.md'):
                post_id = filename.split('-')[-1].replace('.md', '')
                existing_posts.add(post_id)
    
    return existing_posts

def fetch_posts(cursor="", existing_posts=None):
    """Fetch posts from 9gag API"""
    url = f"https://9gag.com/v1/feed-posts/type/home"
    if cursor:
        url += f"?after={cursor}"
    
    print(f"Fetching posts from: {url}")
    
    try:
        response = requests.get(url, headers=HEADERS)
        print(f"Response status: {response.status_code}")
        response.raise_for_status()
        
        try:
            data = response.json()
            print(f"Response data keys: {data.keys() if data else 'None'}")
            if data and 'data' in data:
                print(f"Data section keys: {data['data'].keys() if data['data'] else 'None'}")
                if 'posts' in data['data']:
                    print(f"Found {len(data['data']['posts'])} posts")
                    # Print first post structure
                    if data['data']['posts']:
                        first_post = data['data']['posts'][0]
                        print(f"First post keys: {first_post.keys()}")
                        print(f"First post id: {first_post.get('id')}")
                        print(f"First post type: {first_post.get('type')}")
                        print(f"First post creator: {first_post.get('creator')}")
            
            if not data or 'data' not in data or 'posts' not in data['data']:
                print(f"Invalid response format: {data}")
                return None
            
            # Filter out existing posts if needed
            if existing_posts is not None:
                filtered_posts = []
                for post in data['data']['posts']:
                    if post.get('id') and post['id'] not in existing_posts:
                        # Clean up URLs in the post
                        if post.get('url'):
                            post['url'] = sanitize_url(post['url'])
                        
                        # Handle creator data safely
                        creator = post.get('creator')
                        if creator:
                            if isinstance(creator, dict):
                                if creator.get('profileUrl'):
                                    creator['profileUrl'] = sanitize_url(creator['profileUrl'])
                            else:
                                post['creator'] = {}  # Reset invalid creator data
                        else:
                            post['creator'] = {}  # Ensure creator exists
                            
                        filtered_posts.append(post)
                
                data['data']['posts'] = filtered_posts
                print(f"Filtered to {len(filtered_posts)} new posts")
            
            return data
        except json.JSONDecodeError as e:
            print(f"Response content: {response.text[:500]}...")  # Print first 500 chars
            raise
            
    except requests.exceptions.RequestException as e:
        print(f"Error making request: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"Error parsing response: {e}")
        return None
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return None

def create_post_file(post):
    # Download media files first
    post = download_post_media(post)
    
    # Create _posts directory if it doesn't exist
    os.makedirs("_posts", exist_ok=True)
    
    # Create api/posts directory for JSON files if it doesn't exist
    os.makedirs("api/posts", exist_ok=True)
    
    # Convert timestamp to date format
    post_date = datetime.fromtimestamp(post['creationTs'])
    date_str = post_date.strftime("%Y-%m-%d")
    
    # Create markdown filename
    md_filename = f"_posts/{date_str}-{post['id']}.md"
    
    # Create JSON filename in api/posts directory
    json_filename = f"api/posts/{post['id']}.json"
    
    # Generate post page URL
    post_page_url = f"/{date_str.replace('-', '/')}/{post['id']}.html"
    
    # Clean up URLs in the post data
    post['url'] = post_page_url  # Replace 9gag URL with our URL
    
    # Clean up image data to remove unused URLs and ensure all URLs are local
    if 'images' in post:
        # Create a list of keys first to avoid modification during iteration
        image_types = list(post['images'].keys())
        for img_type in image_types:
            if img_type == 'imageFbThumbnail':
                del post['images'][img_type]
                continue
                
            if 'webpUrl' in post['images'][img_type]:
                del post['images'][img_type]['webpUrl']
            if img_type == 'image460sv':
                for key in ['vp8Url', 'h265Url', 'vp9Url', 'av1Url']:
                    if key in post['images'][img_type]:
                        del post['images'][img_type][key]
            
            # Ensure URL is local
            if 'url' in post['images'][img_type] and '9gag' in post['images'][img_type]['url']:
                if img_type == 'image460sv':
                    post['images'][img_type]['url'] = f"/assets/media/{post['id']}_video.mp4"
                else:
                    post['images'][img_type]['url'] = f"/assets/media/{post['id']}_{img_type}.jpg"
    
    # Prepare front matter without creator field
    front_matter = {
        'layout': 'post',
        'id': post['id'],
        'url': post_page_url,
        'post_url': post_page_url,
        'title': post['title'],
        'description': post['description'],
        'type': post['type'],
        'nsfw': post['nsfw'],
        'upVoteCount': post['upVoteCount'],
        'downVoteCount': post['downVoteCount'],
        'creationTs': post['creationTs'],
        'promoted': post['promoted'],
        'badges': post['badges'],
        'images': post['images'],
        'commentsCount': post['commentsCount'],
        'tags': post.get('tags', []),
        'interests': post.get('interests', [])
    }
    
    # Write markdown file with more structured content
    with open(md_filename, 'w', encoding='utf-8') as f:
        f.write('---\n')
        json.dump(front_matter, f, indent=2, ensure_ascii=False)
        f.write('\n---\n\n')
        
        # Add structured content for better SEO
        f.write(f"# {post['title']}\n\n")
        
        if post['description']:
            f.write(f"{post['description']}\n\n")
        
        # Add media section with local paths
        if post['type'] == 'Photo':
            f.write(f"![{post['title']}]({post['images']['image700']['url']})\n\n")
        elif post['type'] == 'Animated' and 'image460sv' in post['images']:
            f.write(f"<video controls playsinline loop{' muted' if not post['images']['image460sv'].get('hasAudio') else ''} poster=\"{post['images']['image460']['url']}\">\n")
            f.write(f"  <source src=\"{post['images']['image460sv']['url']}\" type=\"video/mp4\">\n")
            f.write("  Your browser does not support the video tag.\n</video>\n\n")
        
        # Add metadata section without creator info
        f.write("## Post Information\n\n")
        f.write(f"- Posted on: {post_date.strftime('%B %d, %Y')}\n")
        f.write(f"- Upvotes: {post['upVoteCount']}\n")
        f.write(f"- Comments: {post['commentsCount']}\n")
        
        # Add tags section if available
        if post['tags']:
            f.write("\n### Tags\n\n")
            for tag in post['tags']:
                tag_url = f"/tag/{tag['key']}"
                f.write(f"- [{tag['key']}]({tag_url})\n")
    
    # Write JSON file with updated structure
    with open(json_filename, 'w', encoding='utf-8') as f:
        json.dump(front_matter, f, indent=2, ensure_ascii=False)
    
    return True

def create_posts_index():
    # Create api directory if it doesn't exist
    os.makedirs("api", exist_ok=True)
    
    posts_index = []
    posts_dir = "_posts"
    
    # Get all post files
    for filename in os.listdir(posts_dir):
        if filename.endswith(".md"):
            post_id = filename.split('-')[-1].replace('.md', '')
            json_file = f"api/posts/{post_id}.json"
            
            # Only include posts that have both markdown and JSON files
            if not os.path.exists(json_file):
                print(f"Skipping {post_id} from index as JSON file doesn't exist")
                continue
                
            with open(os.path.join(posts_dir, filename), 'r', encoding='utf-8') as f:
                content = f.read()
                # Extract front matter between the first two '---' markers
                front_matter = content.split('---')[1].strip()
                try:
                    post_data = json.loads(front_matter)
                    # Generate post URL from filename
                    date_str = filename[:10]  # Extract date from filename (YYYY-MM-DD)
                    post_url = f"/{date_str.replace('-', '/')}/{post_data['id']}.html"
                    
                    # Add only necessary info for index
                    posts_index.append({
                        'id': post_data['id'],
                        'json_url': f"/api/posts/{post_data['id']}.json",
                        'post_url': post_url,
                        'title': post_data['title'],
                        'type': post_data['type'],
                        'creationTs': post_data['creationTs']
                    })
                except json.JSONDecodeError as e:
                    print(f"Error parsing {filename}: {e}")
                    continue
    
    # Sort by creation timestamp descending
    posts_index.sort(key=lambda x: x['creationTs'], reverse=True)
    
    return posts_index

def save_posts_index(posts_index, last_cursor=""):
    # Write index file with last cursor
    with open('api/posts_index.json', 'w', encoding='utf-8') as f:
        json.dump({
            'meta': {
                'timestamp': int(time.time()),
                'status': 'Success',
                'last_cursor': last_cursor
            },
            'data': {
                'posts': posts_index
            }
        }, f, indent=2)

def get_last_cursor():
    try:
        if os.path.exists('api/posts_index.json'):
            with open('api/posts_index.json', 'r') as f:
                data = json.load(f)
                return data.get('meta', {}).get('last_cursor', '')
    except Exception as e:
        print(f"Error reading last cursor: {e}")
    return ""

def main():
    # Get existing posts first
    existing_posts = get_existing_posts()
    print(f"Found {len(existing_posts)} existing posts")
    
    # Get the last cursor from posts_index.json
    cursor = get_last_cursor()
    if cursor:
        print(f"Continuing from last cursor: {cursor}")
    
    total_posts = 0
    retries = 3  # Number of retries for failed requests
    empty_pages = 0  # Counter for consecutive empty pages
    
    try:
        while empty_pages < 3:  # Only stop after 3 consecutive empty pages
            for attempt in range(retries):
                data = fetch_posts(cursor, existing_posts)
                if data is not None:
                    break
                if attempt < retries - 1:
                    print(f"Retrying... (attempt {attempt + 2}/{retries})")
                    time.sleep(random.uniform(1, 3))  # Add delay between retries
            
            if not data:
                print("Failed to fetch posts after all retries")
                break
                
            if not data['data']['posts']:
                print("No new posts found")
                empty_pages += 1
                if empty_pages >= 3:
                    print("No new posts found in 3 consecutive pages, stopping")
                    break
            else:
                empty_pages = 0  # Reset counter when we find posts
                
            for post in data['data']['posts']:
                if post['id'] not in existing_posts:
                    if create_post_file(post):
                        total_posts += 1
                        existing_posts.add(post['id'])
                        print(f"Created post {post['id']} (Total: {total_posts})")
                        
                        # Save index after each post
                        posts_index = create_posts_index()
                        save_posts_index(posts_index, cursor)
                        
                        # Add longer delay between posts (5-10 seconds)
                        delay = random.uniform(5, 10)
                        print(f"Waiting {delay:.1f} seconds before next post...")
                        time.sleep(delay)
            
            cursor = data['data'].get('nextCursor', '').replace('after=', '')
            if not cursor:
                print("No more pages available")
                break
            
            # Add delay between pages
            page_delay = random.uniform(2, 4)
            print(f"Fetching next page in {page_delay:.1f} seconds...")
            time.sleep(page_delay)
    
    except KeyboardInterrupt:
        print("\nScript interrupted by user")
    finally:
        # Create and save posts index with last cursor
        posts_index = create_posts_index()
        save_posts_index(posts_index, cursor)
        print(f"\nFetched {total_posts} new posts and created index")
        if cursor:
            print(f"Last cursor saved: {cursor}")

if __name__ == "__main__":
    main() 