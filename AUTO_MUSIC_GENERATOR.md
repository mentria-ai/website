# Auto Music Generator Workflow

## 🎵 Overview

The **Auto Music Generator** is a GitHub Actions workflow that automatically generates music requests every 15 minutes using AI. It leverages Together AI's DeepSeek-V3 model to create diverse, creative music parameters and automatically submits them as GitHub issues for the OctoBeats Music Generator to process.

## ⚡ Features

### 🤖 AI-Powered Generation
- **Model**: DeepSeek-V3 (Together AI)
- **Creative Diversity**: Generates unique musical styles, genres, and combinations
- **Time-Aware**: Considers current time and date for contextual music themes
- **Fallback System**: Uses predefined fallback parameters if AI generation fails

### 🎼 Music Parameter Generation
- **Style Prompts**: Creative genre combinations, instruments, tempo, mood
- **Lyrics/Structure**: Both instrumental (`[inst]`) and vocal compositions with structure tags
- **Duration**: Smart selection from 30-240 seconds based on composition type
- **Quality**: Always set to "ultra" for maximum fidelity

### 🕐 Scheduling & Triggers
- **Automatic**: Runs every 15 minutes via cron schedule
- **Manual**: Can be triggered manually with optional custom themes
- **Workflow Dispatch**: Supports manual execution with theme input

## 🚀 How It Works

### 1. **Schedule Trigger**
```yaml
schedule:
  - cron: '*/15 * * * *'  # Every 15 minutes
```

### 2. **AI Parameter Generation**
- Creates a comprehensive system prompt for DeepSeek-V3
- Includes current time/date context for themed generation
- Requests structured JSON output with all required parameters
- Validates and sanitizes generated parameters

### 3. **GitHub Issue Creation**
- Formats parameters according to `music-generation.yml` template
- Adds auto-generated labels: `['audio', 'octobeats', 'auto-generated']`
- Includes AI inspiration notes and generation metadata
- Pre-checks all confirmation checkboxes

### 4. **Integration with OctoBeats**
- Created issues automatically trigger the `octobeats-music-generator.yml` workflow
- Concurrency control prevents conflicts with manually created issues
- Full integration with existing music generation pipeline

## 🎨 AI System Prompt Features

### **Creative Guidelines**
- **Musical Diversity**: Explores different genres, moods, styles
- **Time-Appropriate**: Considers time of day and seasonal themes  
- **Cultural Influences**: Various regional and world music styles
- **Experimental Fusion**: Creative genre combinations

### **Example Generations**
- `"ambient electronic, ethereal pads, 85 bpm, reverb-heavy"`
- `"jazzy hip-hop, vinyl crackle, saxophone, laid-back groove"`
- `"orchestral epic, cinematic strings, powerful brass, dramatic"`
- `"lo-fi synthwave, nostalgic, analog warmth, 90s vibes"`

### **Lyric Styles**
- **Instrumental**: `[inst]` or structure tags like `[intro][build][drop][outro]`
- **Vocal**: Original lyrics with `[verse]`, `[chorus]`, `[bridge]`, `[outro]` tags
- **Structured**: Creative arrangements matching musical style

## 📊 Workflow Steps

### 1. **Validate Setup** (validate-setup)
- Checks Together API key availability
- Creates timestamped log file
- Initializes workflow tracking

### 2. **Generate Parameters** (generate-params)  
- Builds AI prompt with current context
- Calls DeepSeek-V3 API with structured request
- Extracts and validates JSON response
- Sanitizes parameters for GitHub issue format

### 3. **Create Issue** (create-issue)
- Formats issue title with AI-generated suggestion
- Creates issue body matching template format
- Submits to GitHub with appropriate labels
- Logs creation details

### 4. **Fallback Handling** (handle-generation-failure)
- Activates if AI generation fails
- Uses predefined style/duration combinations
- Creates basic but functional music request
- Ensures continuous operation

### 5. **Cleanup** (cleanup-and-finalize)
- Removes temporary files
- Finalizes logging
- Reports workflow status

## 🛠️ Configuration

### **Required Secrets**
- `TOGETHER_API_KEY`: Together AI API key for DeepSeek-V3 access

### **Permissions**
```yaml
permissions:
  contents: read
  issues: write  
  actions: read
```

### **Runner Requirements**
- **Self-hosted runner**: Same as OctoBeats workflow
- **Timeout**: 10 minutes (lightweight operation)

## 🎯 Manual Triggering

### **Workflow Dispatch**
```bash
# Via GitHub CLI
gh workflow run auto-music-generator.yml

# With custom theme
gh workflow run auto-music-generator.yml -f custom_theme="ambient"
```

### **Custom Theme Examples**
- `"ambient"` - Focus on ambient/atmospheric styles
- `"electronic"` - Electronic music emphasis
- `"orchestral"` - Classical/orchestral arrangements
- `"world"` - World music influences
- `"experimental"` - Experimental/fusion genres

## 📈 Generated Issue Format

### **Issue Title**
```
[MUSIC] {AI_Generated_Title} - Auto Generated {Timestamp}
```

### **Issue Body Structure**
- **Style Prompt**: AI-generated genre/style description
- **Lyrics**: Either `[inst]` or structured vocal lyrics
- **Duration**: 30-240 seconds (AI-selected)
- **Quality**: Always "ultra"
- **Additional Notes**: AI inspiration and metadata
- **Pre-checked Confirmations**: All required checkboxes

### **Labels Applied**
- `audio` - Triggers OctoBeats workflow
- `octobeats` - OctoBeats system identifier
- `auto-generated` - Identifies automated requests

## 🔄 Integration with Existing Workflows

### **OctoBeats Music Generator**
- Auto-generated issues trigger music generation
- Concurrency control prevents conflicts
- Same processing pipeline as manual requests

### **Issue Assistant**
- Filters out auto-generated issues to prevent interference
- Dedicated handling for music generation issues

## 📝 Logging & Monitoring

### **Workflow Logs**
- Timestamped log files for each run
- AI generation details and responses
- Issue creation tracking
- Error handling and fallback usage

### **Artifacts**
- **Log Files**: Detailed workflow execution logs
- **API Responses**: AI model responses for debugging
- **Generated Parameters**: JSON files with all parameters
- **Retention**: 7 days for analysis

## 🚨 Error Handling

### **AI Generation Failures**
- **Fallback Parameters**: Predefined style/duration combinations
- **Random Selection**: Ensures variety even in fallback mode
- **Graceful Degradation**: Always creates a valid music request

### **API Issues**
- **Timeout Handling**: 10-minute workflow timeout
- **Network Errors**: Logged and handled gracefully
- **Invalid Responses**: Validation and sanitization

### **GitHub API Errors**
- **Issue Creation**: Comprehensive error logging
- **Permission Issues**: Clear error messages
- **Rate Limiting**: Handled by GitHub Actions

## 📊 Expected Output

### **Frequency**
- **96 issues per day** (every 15 minutes)
- **~2,880 issues per month**
- **Continuous music generation** for radio content

### **Diversity**
- **Genre Variety**: 20+ different musical styles
- **Temporal Themes**: Time and date-appropriate content
- **Creative Combinations**: Unique AI-generated concepts

### **Quality**
- **Ultra Quality**: All generations use highest quality setting
- **Structured Output**: Properly formatted for OctoBeats processing
- **Validated Parameters**: All inputs validated before submission

## 🎉 Benefits

### **For Content Creation**
- **Continuous Stream**: Never-ending music generation
- **Creative Diversity**: AI ensures variety and novelty
- **Zero Manual Effort**: Fully automated process

### **For Radio Experience**
- **Fresh Content**: New tracks every 15 minutes
- **Diverse Programming**: Wide range of musical styles
- **Consistent Quality**: Ultra-quality generation

### **For Development**
- **System Testing**: Continuous workflow testing
- **Performance Monitoring**: Regular system exercise
- **Feature Validation**: Automated testing of generation pipeline

## 🔧 Troubleshooting

### **Common Issues**
1. **Missing API Key**: Ensure `TOGETHER_API_KEY` is set in repository secrets
2. **Workflow Not Triggering**: Check if self-hosted runner is active
3. **AI Generation Failing**: Review Together AI account status and quota
4. **Issue Creation Errors**: Verify repository permissions

### **Debugging**
- **Workflow Logs**: Check uploaded artifacts for detailed logs
- **Manual Trigger**: Use workflow dispatch to test manually
- **API Response**: Review generated JSON for validation issues

---

## ✅ Quick Start

1. **Ensure Prerequisites**:
   - Together AI API key in repository secrets
   - Self-hosted runner with OctoBeats setup
   - Repository permissions for issue creation

2. **Workflow File**: Already created at `.github/workflows/auto-music-generator.yml`

3. **Automatic Operation**: Workflow runs every 15 minutes automatically

4. **Monitor Results**: Check repository issues for auto-generated music requests

5. **Customize**: Use workflow dispatch with custom themes for specific music styles

---

**🎵 The Auto Music Generator ensures your OctoBeats radio never runs out of fresh, AI-created music content!** 