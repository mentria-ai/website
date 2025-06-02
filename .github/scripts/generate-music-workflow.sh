#!/bin/bash
set -e

# Auto Music Generator Workflow Script
# This script orchestrates the entire music generation process

# Set script directory for global use
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
    if [[ -n "$LOG_FILE" ]]; then
        echo "$(date -u +'%Y-%m-%d %H:%M:%S') [INFO] $1" >> "$LOG_FILE"
    fi
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    if [[ -n "$LOG_FILE" ]]; then
        echo "$(date -u +'%Y-%m-%d %H:%M:%S') [ERROR] $1" >> "$LOG_FILE"
    fi
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
    if [[ -n "$LOG_FILE" ]]; then
        echo "$(date -u +'%Y-%m-%d %H:%M:%S') [WARNING] $1" >> "$LOG_FILE"
    fi
}

# Initialize logging
init_logging() {
    LOG_FILE="auto_music_generator_$(date +%Y%m%d_%H%M%S).log"
    echo "# Auto Music Generator Log - $(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$LOG_FILE"
    echo "## Workflow Started" >> "$LOG_FILE"
    echo "- Triggered by: ${GITHUB_EVENT_NAME:-manual}" >> "$LOG_FILE"
    echo "- Run ID: ${GITHUB_RUN_ID:-N/A}" >> "$LOG_FILE"
    echo "- Repository: ${GITHUB_REPOSITORY:-N/A}" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
    
    # Set output for GitHub Actions
    if [[ -n "$GITHUB_OUTPUT" ]]; then
        echo "log_file=$LOG_FILE" >> "$GITHUB_OUTPUT"
    fi
    
    log_info "Logging initialized to $LOG_FILE"
}

# Validate environment
validate_environment() {
    log_info "Validating environment..."
    
    if [[ -z "$TOGETHER_API_KEY" ]]; then
        log_error "Missing Together API key. Please add it to your repository secrets."
        return 1
    fi
    
    if [[ -z "$GITHUB_TOKEN" ]]; then
        log_error "Missing GitHub token."
        return 1
    fi
    
    # Check if required scripts exist
    REQUIRED_SCRIPTS=(
        "$SCRIPT_DIR/generate-music-prompt.py"
        "$SCRIPT_DIR/create-api-request.py"
        "$SCRIPT_DIR/process-ai-response.py"
        "$SCRIPT_DIR/create-music-issue.js"
    )
    
    for script in "${REQUIRED_SCRIPTS[@]}"; do
        if [[ ! -f "$script" ]]; then
            log_error "Required script not found: $script"
            return 1
        fi
    done
    
    log_info "Environment validation completed successfully"
    return 0
}

# Generate music prompt
generate_prompt() {
    log_info "Generating music prompt..."
    
    export CUSTOM_THEME="${CUSTOM_THEME:-}"
    export CUSTOM_SEED="${CUSTOM_SEED:-}"
    
    if [[ -n "$CUSTOM_THEME" ]]; then
        log_info "Using custom theme: $CUSTOM_THEME"
    fi
    
    if [[ -n "$CUSTOM_SEED" ]]; then
        log_info "Using specified seed: $CUSTOM_SEED"
    fi
    
    python3 "$SCRIPT_DIR/generate-music-prompt.py"
    
    if [[ ! -f "music_generation_prompt.txt" ]]; then
        log_error "Failed to generate music prompt"
        return 1
    fi
    
    log_info "Music prompt generated successfully"
    return 0
}

# Create API request
create_api_request() {
    log_info "Creating API request payload..."
    
    python3 "$SCRIPT_DIR/create-api-request.py"
    
    if [[ ! -f "api_request.json" ]]; then
        log_error "Failed to create API request payload"
        return 1
    fi
    
    log_info "API request payload created successfully"
    return 0
}

# Make API call
make_api_call() {
    log_info "Making API call to Together AI..."
    
    HTTP_STATUS=$(curl -s -w "%{http_code}" -X POST "https://api.together.xyz/v1/chat/completions" \
        -H "Authorization: Bearer $TOGETHER_API_KEY" \
        -H "Content-Type: application/json" \
        -d @api_request.json \
        -o api_response.json)
    
    log_info "HTTP Status Code: $HTTP_STATUS"
    
    if [[ "$HTTP_STATUS" == "200" ]]; then
        if [[ -f "api_response.json" && -s "api_response.json" ]]; then
            # Validate JSON format
            if python3 -c "import json; json.load(open('api_response.json'))" 2>/dev/null; then
                log_info "API call completed successfully"
                return 0
            else
                log_error "API response is not valid JSON"
                if [[ -f "api_response.json" ]]; then
                    log_error "Raw response content:"
                    cat api_response.json >> "$LOG_FILE"
                fi
                return 1
            fi
        else
            log_error "API response file is missing or empty"
            return 1
        fi
    else
        log_error "API call failed with HTTP status: $HTTP_STATUS"
        if [[ -f "api_response.json" ]]; then
            log_error "Error response content:"
            cat api_response.json >> "$LOG_FILE"
        fi
        return 1
    fi
}

# Process AI response
process_response() {
    log_info "Processing AI response..."
    
    python3 "$SCRIPT_DIR/process-ai-response.py"
    
    if [[ -f "music_parameters.txt" ]]; then
        if grep -q "SUCCESS=true" music_parameters.txt; then
            log_info "AI response processed successfully"
            
            # Log the generated parameters
            echo "" >> "$LOG_FILE"
            echo "## Generated Parameters:" >> "$LOG_FILE"
            grep -E "^(STYLE_PROMPT|LYRICS|DURATION|TITLE_SUGGESTION|INSPIRATION|SEED)=" music_parameters.txt >> "$LOG_FILE"
            
            return 0
        else
            log_warning "AI response processing failed, will use fallback parameters"
            return 1
        fi
    else
        log_error "Failed to process AI response"
        return 1
    fi
}

# Create GitHub issue
create_issue() {
    log_info "Creating GitHub issue..."
    
    # Install Node.js dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        npm init -y > /dev/null 2>&1
        npm install @octokit/rest > /dev/null 2>&1
    fi
    
    # Set environment variables for the script
    export LOG_FILE
    export GITHUB_TOKEN
    export GITHUB_REPOSITORY
    export GITHUB_OUTPUT
    export CUSTOM_THEME
    export CUSTOM_SEED
    
    node "$SCRIPT_DIR/create-music-issue.js"
    
    return $?
}

# Cleanup temporary files
cleanup() {
    log_info "Cleaning up temporary files..."
    
    rm -f music_generation_prompt.txt api_request.json api_response.json
    rm -f response_content.txt extracted_json.json music_parameters.txt
    rm -f package.json package-lock.json
    rm -rf node_modules
    
    log_info "Cleanup completed"
}

# Main function
main() {
    log_info "Starting Auto Music Generator workflow..."
    
    # Initialize logging
    init_logging
    
    # Validate environment
    if ! validate_environment; then
        log_error "Environment validation failed"
        exit 1
    fi
    
    # Generate prompt
    if ! generate_prompt; then
        log_error "Prompt generation failed"
        exit 1
    fi
    
    # Create API request
    if ! create_api_request; then
        log_error "API request creation failed"
        exit 1
    fi
    
    # Make API call
    if ! make_api_call; then
        log_warning "API call failed, will proceed with fallback parameters"
    fi
    
    # Process response (will use fallback if AI response processing fails)
    if ! process_response; then
        log_warning "Using fallback parameters due to AI processing failure"
    fi
    
    # Create issue (handles both successful and fallback scenarios)
    if ! create_issue; then
        log_error "Failed to create GitHub issue"
        exit 1
    fi
    
    # Cleanup
    cleanup
    
    log_info "Auto Music Generator workflow completed successfully"
    
    echo "" >> "$LOG_FILE"
    echo "## Workflow Completion" >> "$LOG_FILE"
    echo "- Completed at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$LOG_FILE"
    echo "- Status: SUCCESS" >> "$LOG_FILE"
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 