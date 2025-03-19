#!/bin/bash
# Setup script for GitHub Assistant system

# Change to the root directory of the repository
cd $(git rev-parse --show-toplevel)

echo "Setting up GitHub Assistant system..."

# Create directory structure
echo "Creating directory structure..."
mkdir -p .github/shared/api
mkdir -p .github/shared/event-handlers
mkdir -p .github/shared/repo-context
mkdir -p .github/shared/response-handlers
mkdir -p .github/shared/utils
mkdir -p .github/scripts

# Make scripts executable
chmod +x .github/scripts/cleanup-logs.sh
chmod +x .github/scripts/setup-assistants.sh

echo "Setup completed!"
echo "Make sure to add your Together AI API key as a repository secret named TOGETHER_API_KEY"
echo "The assistants are now ready to use." 