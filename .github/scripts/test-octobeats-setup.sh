#!/bin/bash

# OctoBeats Setup Validation Script
# This script tests the OctoBeats server setup and workflow prerequisites

set -e

echo "🎵 OctoBeats Setup Validation"
echo "============================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "SUCCESS")
            echo -e "${GREEN}✅ $message${NC}"
            ;;
        "ERROR")
            echo -e "${RED}❌ $message${NC}"
            ;;
        "WARNING")
            echo -e "${YELLOW}⚠️  $message${NC}"
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️  $message${NC}"
            ;;
    esac
}

# Test 1: Check if required tools are available
echo "1. Checking required tools..."
echo "----------------------------"

# Check curl
if command -v curl &> /dev/null; then
    print_status "SUCCESS" "curl is available"
else
    print_status "ERROR" "curl is not installed"
    exit 1
fi

# Check jq
if command -v jq &> /dev/null; then
    print_status "SUCCESS" "jq is available"
else
    print_status "ERROR" "jq is not installed"
    exit 1
fi

# Check git
if command -v git &> /dev/null; then
    print_status "SUCCESS" "git is available"
else
    print_status "ERROR" "git is not installed"
    exit 1
fi

echo ""

# Test 2: Check OctoBeats server connectivity
echo "2. Testing OctoBeats server connectivity..."
echo "------------------------------------------"

OCTOBEATS_URL="http://localhost:8000"

# Test server status endpoint
if curl -f -s "$OCTOBEATS_URL/api/status" > /dev/null 2>&1; then
    print_status "SUCCESS" "OctoBeats server is accessible at $OCTOBEATS_URL"
    
    # Get detailed status
    STATUS_RESPONSE=$(curl -s "$OCTOBEATS_URL/api/status")
    SERVER_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status // "unknown"')
    IS_GENERATING=$(echo "$STATUS_RESPONSE" | jq -r '.generation.is_generating // false')
    
    print_status "INFO" "Server status: $SERVER_STATUS"
    print_status "INFO" "Currently generating: $IS_GENERATING"
    
    if [ "$SERVER_STATUS" = "ready" ]; then
        print_status "SUCCESS" "Server is ready for audio generation"
    else
        print_status "WARNING" "Server status is not 'ready'"
    fi
    
    if [ "$IS_GENERATING" = "true" ]; then
        print_status "WARNING" "Server is currently generating audio"
    fi
    
else
    print_status "ERROR" "Cannot connect to OctoBeats server at $OCTOBEATS_URL"
    print_status "INFO" "Make sure OctoBeats Studio is running on localhost:8000"
    exit 1
fi

echo ""

# Test 3: Test API endpoints
echo "3. Testing OctoBeats API endpoints..."
echo "------------------------------------"

# Test generate endpoint (without actually generating)
if curl -f -s -X POST "$OCTOBEATS_URL/api/generate" \
   -H "Content-Type: application/json" \
   -d '{}' > /dev/null 2>&1; then
    print_status "SUCCESS" "Generate endpoint is accessible"
else
    # This might fail due to missing parameters, which is expected
    print_status "INFO" "Generate endpoint responded (parameter validation expected)"
fi

# Test files endpoint
if curl -f -s "$OCTOBEATS_URL/api/files" > /dev/null 2>&1; then
    print_status "SUCCESS" "Files endpoint is accessible"
    
    # Get file count
    FILES_RESPONSE=$(curl -s "$OCTOBEATS_URL/api/files")
    FILE_COUNT=$(echo "$FILES_RESPONSE" | jq -r '.total_count // 0')
    print_status "INFO" "Total files available: $FILE_COUNT"
else
    print_status "ERROR" "Files endpoint is not accessible"
fi

echo ""

# Test 4: Check workflow file
echo "4. Checking workflow configuration..."
echo "-----------------------------------"

WORKFLOW_FILE=".github/workflows/octobeats-music-generator.yml"

if [ -f "$WORKFLOW_FILE" ]; then
    print_status "SUCCESS" "Workflow file exists: $WORKFLOW_FILE"
    
    # Check if workflow has required triggers
    if grep -q "issues:" "$WORKFLOW_FILE"; then
        print_status "SUCCESS" "Workflow has issue triggers configured"
    else
        print_status "ERROR" "Workflow missing issue triggers"
    fi
    
    # Check if workflow runs on self-hosted
    if grep -q "runs-on: self-hosted" "$WORKFLOW_FILE"; then
        print_status "SUCCESS" "Workflow configured for self-hosted runner"
    else
        print_status "WARNING" "Workflow not configured for self-hosted runner"
    fi
    
else
    print_status "ERROR" "Workflow file not found: $WORKFLOW_FILE"
fi

echo ""

# Test 5: Check issue templates
echo "5. Checking issue templates..."
echo "-----------------------------"

TEMPLATE_DIR=".github/ISSUE_TEMPLATE"

if [ -d "$TEMPLATE_DIR" ]; then
    print_status "SUCCESS" "Issue template directory exists"
    
    # Check for music generation template
    if [ -f "$TEMPLATE_DIR/music-generation.yml" ]; then
        print_status "SUCCESS" "Music generation template (YAML) found"
    else
        print_status "WARNING" "Music generation template (YAML) not found"
    fi
    
    if [ -f "$TEMPLATE_DIR/music-generation-simple.md" ]; then
        print_status "SUCCESS" "Music generation template (Markdown) found"
    else
        print_status "WARNING" "Music generation template (Markdown) not found"
    fi
    
else
    print_status "WARNING" "Issue template directory not found"
fi

echo ""

# Test 6: Check repository structure
echo "6. Checking repository structure..."
echo "---------------------------------"

# Check if we're in a git repository
if git rev-parse --git-dir > /dev/null 2>&1; then
    print_status "SUCCESS" "Running in a git repository"
    
    # Check if audio directory exists
    if [ -d "audio" ]; then
        print_status "INFO" "Audio directory already exists"
    else
        print_status "INFO" "Audio directory will be created when needed"
    fi
    
    # Check if generated directory exists
    if [ -d "audio/generated" ]; then
        print_status "INFO" "Generated audio directory already exists"
        AUDIO_COUNT=$(find audio/generated -name "*.mp3" 2>/dev/null | wc -l)
        print_status "INFO" "Existing audio files: $AUDIO_COUNT"
    else
        print_status "INFO" "Generated audio directory will be created when needed"
    fi
    
else
    print_status "ERROR" "Not running in a git repository"
fi

echo ""

# Test 7: Simulate parameter extraction
echo "7. Testing parameter extraction..."
echo "--------------------------------"

# Test sample issue body
SAMPLE_ISSUE_BODY="## Music Generation Request

**Prompt:** electronic, melodic, cyberpunk, 120 bpm
**Lyrics:** [inst]
**Duration:** 60
**Mode:** quality

This is a test request for music generation."

echo "Sample issue body:"
echo "$SAMPLE_ISSUE_BODY"
echo ""

# Extract parameters using the same logic as the workflow
PROMPT=$(echo "$SAMPLE_ISSUE_BODY" | grep -i "prompt:" | sed 's/.*prompt:[[:space:]]*//' | head -1)
LYRICS=$(echo "$SAMPLE_ISSUE_BODY" | grep -i "lyrics:" | sed 's/.*lyrics:[[:space:]]*//' | head -1)
DURATION=$(echo "$SAMPLE_ISSUE_BODY" | grep -i "duration:" | sed 's/.*duration:[[:space:]]*//' | grep -o '[0-9]*' | head -1)
MODE=$(echo "$SAMPLE_ISSUE_BODY" | grep -i "mode:" | sed 's/.*mode:[[:space:]]*//' | head -1)

if [ ! -z "$PROMPT" ]; then
    print_status "SUCCESS" "Extracted prompt: $PROMPT"
else
    print_status "ERROR" "Failed to extract prompt"
fi

if [ ! -z "$LYRICS" ]; then
    print_status "SUCCESS" "Extracted lyrics: $LYRICS"
else
    print_status "ERROR" "Failed to extract lyrics"
fi

if [ ! -z "$DURATION" ]; then
    print_status "SUCCESS" "Extracted duration: $DURATION"
else
    print_status "ERROR" "Failed to extract duration"
fi

if [ ! -z "$MODE" ]; then
    print_status "SUCCESS" "Extracted mode: $MODE"
else
    print_status "ERROR" "Failed to extract mode"
fi

echo ""

# Summary
echo "🎯 Setup Validation Summary"
echo "=========================="

# Count successes and errors
SUCCESS_COUNT=$(grep -c "✅" <<< "$(cat)")
ERROR_COUNT=$(grep -c "❌" <<< "$(cat)")

if [ $ERROR_COUNT -eq 0 ]; then
    print_status "SUCCESS" "All tests passed! Your OctoBeats setup is ready."
    echo ""
    echo "🚀 Next steps:"
    echo "1. Create an issue using the music generation template"
    echo "2. Add the 'audio' or 'octobeats' label to the issue"
    echo "3. The workflow will automatically generate music and create a PR"
else
    print_status "ERROR" "Some tests failed. Please fix the issues above before using the workflow."
fi

echo ""
echo "📖 For more information, see:"
echo "   - .github/workflows/README-octobeats.md"
echo "   - OctoBeats API Documentation"

exit $ERROR_COUNT 