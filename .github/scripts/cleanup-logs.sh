#!/bin/bash
# Cleanup script for GitHub Assistant log files and temporary data

# Set the maximum age for files (in days)
MAX_AGE=7

# Change to the root directory of the repository
cd $(git rev-parse --show-toplevel)

echo "Cleaning up GitHub Assistant temporary files and logs..."

# Clean up workflow log files
echo "Removing workflow log files older than $MAX_AGE days..."
find . -name "workflow_*.log" -type f -mtime +$MAX_AGE -delete

# Clean up content files
echo "Removing content files..."
rm -rf content_files/
rm -rf context_analysis/
rm -rf response_files/
rm -rf error_logs/

# Clean up temporary files
echo "Removing temporary files..."
rm -f content_data.json
rm -f response.txt
rm -f repo_context.md

echo "Cleanup completed!" 