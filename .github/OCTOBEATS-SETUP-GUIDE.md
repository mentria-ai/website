# 🎵 OctoBeats Music Generation Setup Guide

This guide will help you set up and use the OctoBeats music generation workflow in your GitHub repository.

## 📋 Quick Start Checklist

- [ ] OctoBeats Studio server running on `localhost:8000`
- [ ] Self-hosted GitHub Actions runner configured
- [ ] Workflow file in place (`.github/workflows/octobeats-music-generator.yml`)
- [ ] Issue templates configured (`.github/ISSUE_TEMPLATE/`)
- [ ] Repository permissions verified (owner/admin/maintainer access)

## 🔧 Prerequisites

### 1. OctoBeats Studio Server
- Install and run OctoBeats Studio on your self-hosted runner machine
- Ensure it's accessible at `http://localhost:8000`
- Verify these endpoints are working:
  - `GET /api/status` - Server status
  - `POST /api/generate` - Music generation
  - `GET /api/download/<filename>` - File download
  - `GET /api/files` - List files

### 2. Self-Hosted GitHub Actions Runner
- Set up a self-hosted runner on the same machine as OctoBeats
- Ensure the runner has access to:
  - `curl` command
  - `jq` command for JSON processing
  - `git` command
  - Network access to `localhost:8000`

### 3. Repository Configuration
- Repository owner, admin, or maintainer permissions required
- Workflow file must be present and properly configured
- Issue templates should be set up for easy parameter input

## 📁 Files Created

This setup creates the following files in your repository:

```
.github/
├── workflows/
│   ├── octobeats-music-generator.yml   # Main workflow
│   └── README-octobeats.md             # Workflow documentation
├── ISSUE_TEMPLATE/
│   ├── music-generation.yml            # YAML form template
│   ├── music-generation-simple.md      # Simple markdown template
│   └── config.yml                      # Template configuration
├── scripts/
│   └── test-octobeats-setup.sh         # Setup validation script
└── OCTOBEATS-SETUP-GUIDE.md           # This guide
```

## 🚀 How to Use

### Step 1: Create an Audio Generation Request

1. **Go to Issues** → **New Issue**
2. **Select Template**: Choose "🎵 Music Generation Request"
3. **Fill in Parameters**:
   - **Music Style Prompt**: `electronic, melodic, cyberpunk, 120 bpm`
   - **Lyrics**: `[inst]` (for instrumental) or actual lyrics
   - **Duration**: `60` (seconds, 30-240 range)
   - **Quality Mode**: `quality` (fast/quality/ultra)
4. **Submit the Issue**

### Step 2: Automatic Processing

The workflow will automatically:
1. ✅ Validate your permissions and issue labels
2. 🔍 Extract parameters from your issue description
3. 🖥️ Check ACE-Step server status
4. 🎵 Generate audio using your parameters
5. 📥 Download the generated audio file
6. 🌿 Create a new branch with the audio
7. 📝 Commit the audio file and metadata
8. 🔄 Create a pull request
9. 💬 Comment on your issue with results

### Step 3: Review and Merge

1. **Check the PR** created by the workflow
2. **Download and listen** to the generated audio
3. **Merge the PR** if you're satisfied with the result
4. **The issue will be automatically closed**

## 🎧 Example Requests

### Electronic/Ambient Music
```yaml
Prompt: electronic, ambient, atmospheric, synthesizer, 90 bpm
Lyrics: [inst]
Duration: 120
Mode: quality
```

### Pop Song with Lyrics
```yaml
Prompt: pop, upbeat, guitar, catchy melody
Lyrics: |
  [verse]
  Walking down the street today
  [chorus]
  Feeling good in every way
  [bridge]
  Music makes the world go round
Duration: 90
Mode: quality
```

### Classical Instrumental
```yaml
Prompt: classical, piano, orchestral, peaceful, adagio
Lyrics: [inst]
Duration: 180
Mode: ultra
```

## 🛠️ Testing Your Setup

Run the validation script to test your setup:

```bash
# On Linux/macOS
chmod +x .github/scripts/test-ace-step-setup.sh
./.github/scripts/test-ace-step-setup.sh

# On Windows (Git Bash)
bash .github/scripts/test-ace-step-setup.sh
```

The script will test:
- Required tools (curl, jq, git)
- ACE-Step server connectivity
- API endpoint accessibility
- Workflow file configuration
- Issue template setup
- Parameter extraction logic

## 🔒 Security Features

### Permission Control
- Only repository owners, admins, and maintainers can request audio generation
- Prevents unauthorized use of computational resources
- Protects against abuse of the ACE-Step server

### Input Validation
- All parameters are validated and sanitized
- Duration limited to 30-240 seconds
- Quality mode restricted to valid options
- Prompts and lyrics are cleaned of problematic characters

### Resource Protection
- Server status checked before generation
- Prevents multiple simultaneous generations
- Automatic cleanup of temporary files
- Generation timeouts prevent hanging processes

## 📊 Generated Files Structure

Audio files are organized in the repository as:

```
audio/
└── generated/
    ├── audio_issue_123_20240115_143022.mp3
    └── audio_issue_123_20240115_143022_metadata.json
```

### Metadata File Example
```json
{
  "issue_number": 123,
  "issue_title": "Generate ambient background music",
  "generated_at": "2024-01-15T14:30:22Z",
  "parameters": {
    "prompt": "electronic, ambient, atmospheric, 90 bpm",
    "lyrics": "[inst]",
    "duration": 120,
    "mode": "quality"
  },
  "generation_time": "24.5",
  "file_size": "2.1M",
  "generated_by": "username"
}
```

## 🐛 Troubleshooting

### Common Issues

#### "Workflow doesn't trigger"
- ✅ Check issue has `audio`, `ace-step`, or `music-generation` label
- ✅ Verify you have owner/admin/maintainer permissions
- ✅ Ensure workflow file exists and is valid YAML

#### "Server connection failed"
- ✅ Verify ACE-Step is running on `localhost:8000`
- ✅ Test manually: `curl http://localhost:8000/api/status`
- ✅ Check firewall settings
- ✅ Ensure self-hosted runner has network access

#### "Generation failed"
- ✅ Check server isn't busy with another generation
- ✅ Verify parameters are within valid ranges
- ✅ Ensure sufficient GPU/CPU resources available
- ✅ Check ACE-Step server logs for errors

#### "Permission denied"
- ✅ Verify GitHub token has necessary permissions
- ✅ Check repository access levels
- ✅ Ensure no branch protection rules blocking commits

### Debug Information

Workflow logs are available as artifacts:
1. Go to **Actions** → **Workflow Run**
2. Download **ace-step-workflow-logs-{run-number}**
3. Check the log file for detailed execution information

## 🔄 Workflow Customization

### Modifying Parameters
Edit `.github/workflows/ace-step-audio-generator.yml` to:
- Change default parameter values
- Modify validation rules
- Adjust file naming conventions
- Add custom labels or metadata

### Adding New Quality Modes
Update the workflow to support additional ACE-Step quality modes:
1. Add new mode to issue template options
2. Update parameter validation in workflow
3. Test with ACE-Step server

### Custom File Organization
Modify the branch creation and file commit steps to:
- Change directory structure
- Add additional metadata
- Integrate with other systems

## 📚 Additional Resources

- **ACE-Step API Documentation**: Complete API reference
- **GitHub Actions Documentation**: Official GitHub Actions docs
- **Self-Hosted Runners Guide**: Setting up runners
- **Issue Templates Guide**: Creating custom templates

## 🆘 Getting Help

If you encounter issues:

1. **Check the troubleshooting section** above
2. **Run the validation script** to identify problems
3. **Review workflow logs** for detailed error information
4. **Create a GitHub issue** with your problem description
5. **Start a discussion** for general questions

---

**🎵 Happy audio generating!** Your ACE-Step workflow is ready to create amazing music from GitHub issues. 