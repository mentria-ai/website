# Scripts

This directory contains scripts for fetching and managing content.

## fetch_9gag_posts.py

This script fetches posts from 9gag and creates markdown files and JSON data for the website.

### Setup and Running

1. Create and activate a Python virtual environment:
```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# .\venv\Scripts\activate
```

2. Install required packages:
```bash
pip install requests
```

3. Run the script:
```bash
python3 fetch_9gag_posts.py
```

### What the script does

- Fetches up to 50 unique posts from 9gag
- Skips posts that have already been fetched
- Creates markdown files in `_posts` directory
- Creates JSON files in `posts` directory
- Generates an index file in `api/posts_index.json`
- Adds SEO-friendly content structure
- Handles both images and videos
- Includes metadata, tags, and creator information

### Output

The script will create:
- Markdown files in `_posts/` (for Jekyll)
- JSON files in `posts/` (for API)
- Index file in `api/posts_index.json`

### Notes

- The script includes random delays between requests to be respectful to the 9gag servers
- Progress is displayed in the terminal
- Existing posts are automatically skipped
- All content is properly formatted for SEO 