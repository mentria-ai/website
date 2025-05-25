# 🎵 OctoBeats Music Generation Workflow

This GitHub Action workflow automatically generates music using OctoBeats Studio based on GitHub issue requests. It provides a seamless integration between GitHub issues and local OctoBeats music generation.

## 🌟 Features

- **Permission-based Access**: Only repository owners, admins, and maintainers can request music generation
- **Automatic Parameter Extraction**: Intelligently extracts music parameters from issue descriptions
- **Server Status Validation**: Checks OctoBeats server availability before generation
- **Automated PR Creation**: Creates branches and pull requests with generated music files
- **Comprehensive Logging**: Detailed logs for debugging and monitoring
- **Metadata Tracking**: Stores generation parameters and metadata alongside music files

## 🔧 Prerequisites

### 1. Self-Hosted Runner
- The workflow requires a self-hosted GitHub Actions runner
- The runner must have access to the OctoBeats server on `localhost:8000`

### 2. OctoBeats Server
- OctoBeats Studio must be running on the runner machine
- Server should be accessible at `http://localhost:8000`
- Ensure the `/api/status`, `/api/generate`, and `/api/download` endpoints are available

### 3. Repository Setup
- The repository must have the workflow file in `.github/workflows/octobeats-music-generator.yml`
- Issue templates should be configured in `.github/ISSUE_TEMPLATE/`

## 📋 How to Use

### Method 1: Using Issue Template (Recommended)

1. **Create New Issue**: Go to Issues → New Issue
2. **Select Template**: Choose "🎵 Music Generation Request"
3. **Fill Parameters**:
   - **Music Style Prompt**: Describe the style (e.g., "electronic, melodic, cyberpunk, 120 bpm")
   - **Lyrics**: Provide lyrics or use structure tags like `[inst]`, `[verse]`, `[chorus]`
   - **Duration**: Select duration in seconds (30-240)
   - **Quality Mode**: Choose fast, quality, or ultra
4. **Submit Issue**: The workflow will automatically trigger

### Method 2: Manual Issue Creation

Create an issue with the `audio` or `octobeats` label and include parameters in the description:

```markdown
## Music Generation Request

**Prompt:** electronic, ambient, atmospheric, 90 bpm
**Lyrics:** [inst]
**Duration:** 120
**Mode:** quality
```

## 🔄 Workflow Process

1. **Trigger Validation**: Checks for required labels and user permissions
2. **Parameter Extraction**: Extracts and validates music generation parameters
3. **Server Status Check**: Verifies OctoBeats server is ready and not busy
4. **Music Generation**: Calls OctoBeats API to generate music
5. **File Download**: Downloads the generated music file
6. **Branch Creation**: Creates a new branch with descriptive name
7. **File Commit**: Commits music file and metadata to the repository
8. **PR Creation**: Opens a pull request with the generated content
9. **Issue Comment**: Posts a summary comment on the original issue

## 📁 File Organization

Generated files are organized as follows:

```
audio/
└── generated/
    ├── audio_issue_123_20240115_143022.mp3
    └── audio_issue_123_20240115_143022_metadata.json
```

### Metadata File Structure

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

## ⚙️ Configuration

### Quality Modes

| Mode | Steps | Guidance | Generation Time | Use Case |
|------|-------|----------|----------------|----------|
| `fast` | 20 | 7.0 | ~12s (60s audio) | Quick previews |
| `quality` | 35 | 12.0 | ~24s (60s audio) | Balanced quality |
| `ultra` | 50 | 15.0 | ~35s (60s audio) | Maximum quality |

### Parameter Validation

- **Duration**: Must be between 30-240 seconds
- **Mode**: Must be one of: fast, quality, ultra
- **Prompt**: Automatically sanitized to remove problematic characters
- **Lyrics**: Supports both plain text and structure tags

## 🛠️ Troubleshooting

### Common Issues

#### Workflow Doesn't Trigger
- **Check Labels**: Ensure issue has `audio`, `ace-step`, or `music-generation` label
- **Check Permissions**: Verify user is owner, admin, or maintainer
- **Check Repository**: Ensure workflow file exists and is properly formatted

#### Server Connection Errors
- **Verify Server**: Check ACE-Step server is running on `localhost:8000`
- **Test Endpoints**: Manually test `/api/status` endpoint
- **Check Firewall**: Ensure no firewall blocking localhost connections

#### Generation Failures
- **Server Busy**: Wait for current generation to complete
- **Invalid Parameters**: Check parameter ranges and formats
- **Server Resources**: Ensure sufficient GPU/CPU resources available

#### Permission Errors
- **Repository Access**: Verify user has required repository permissions
- **Token Permissions**: Check GitHub token has necessary scopes
- **Branch Protection**: Ensure no branch protection rules blocking commits

### Debug Information

The workflow creates detailed logs available as artifacts:
- Navigate to Actions → Workflow Run → Artifacts
- Download `ace-step-workflow-logs-{run-number}`
- Check the log file for detailed execution information

## 🔒 Security Considerations

### Permission Model
- Only repository owners, admins, and maintainers can trigger audio generation
- Prevents unauthorized use of computational resources
- Protects against potential abuse of the ACE-Step server

### Input Sanitization
- All user inputs are sanitized to prevent injection attacks
- File paths are validated to prevent directory traversal
- API parameters are validated against expected ranges

### Resource Protection
- Server status checks prevent overloading
- Generation timeouts prevent hanging processes
- Automatic cleanup of temporary files

## 📊 Monitoring and Analytics

### Workflow Metrics
- Generation success/failure rates
- Average generation times by quality mode
- Resource usage patterns
- User activity patterns

### Log Analysis
- All operations are logged with timestamps
- Error conditions are clearly marked
- Performance metrics are tracked

## 🚀 Advanced Usage

### Custom Parameters
You can use advanced parameter formats in issue descriptions:

```markdown
- Prompt: electronic, cyberpunk, dark, 128 bpm, synthesizer
- Lyrics: [verse]\nIn the neon lights\n[chorus]\nWe dance tonight
- Duration: 90
- Mode: ultra
```

### Batch Generation
Create multiple issues for batch generation of related audio files.

### Integration with Other Workflows
The generated audio files can be used by other workflows for:
- Automatic deployment to audio hosting services
- Integration with video generation workflows
- Automated testing of audio processing pipelines

## 📝 Contributing

### Workflow Improvements
- Submit PRs for workflow enhancements
- Report bugs via GitHub issues
- Suggest new features in discussions

### Documentation Updates
- Keep this README updated with changes
- Add examples for new use cases
- Improve troubleshooting guides

## 📄 License

This workflow is part of the repository and follows the same license terms.

---

**Need Help?** Create a discussion or issue for support with the ACE-Step audio generation workflow. 