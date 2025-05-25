# 🔄 Workflow Coordination Guide

This document explains how the different GitHub Actions workflows in this repository coordinate to avoid conflicts and ensure proper handling of different types of issues.

## 📋 Overview

The repository has multiple automated workflows that respond to GitHub issues and comments:

1. **Issue Assistant** (`.github/workflows/issue-assistant.yml`) - AI-powered assistance for general technical questions
2. **OctoBeats Music Generator** (`.github/workflows/octobeats-music-generator.yml`) - Automated music generation from issues

## 🎯 Workflow Filtering Logic

To prevent conflicts and ensure each issue is handled by the appropriate workflow, we implement intelligent filtering:

### Issue Assistant Filtering

The Issue Assistant workflow **SKIPS** processing for:

#### 🎵 Music Generation Issues
- Issues with labels: `audio`, `octobeats`, `music-generation`, `music`
- Issues with title patterns: `[MUSIC]`, `[AUDIO]`, `music generation`, `audio generation`, `octobeats`
- Comments from OctoBeats workflow (containing keywords like "Audio Generated Successfully")

#### 🤖 Bot-Generated Issues
- Issues created by bots: `dependabot`, `renovate`, `github-actions`, etc.
- Automated dependency updates and similar maintenance issues

#### 🔄 OctoBeats Workflow Comments
- Comments from `github-actions[bot]` on music generation issues
- Comments containing OctoBeats-specific keywords

### OctoBeats Music Generator Filtering

The OctoBeats workflow **ONLY PROCESSES** issues that:
- Have required labels: `audio`, `octobeats`, or `music-generation`
- Are created by users with appropriate permissions (owner/admin/maintainer)
- Follow the music generation issue template format

## 🚦 Workflow Decision Tree

```
New Issue/Comment Created
│
├─ Has music generation labels/title?
│  ├─ YES → OctoBeats Music Generator
│  └─ NO → Continue to Issue Assistant check
│
├─ Created by bot?
│  ├─ YES → Skip (no processing)
│  └─ NO → Continue to Issue Assistant check
│
├─ Comment from OctoBeats workflow?
│  ├─ YES → Skip (no processing)
│  └─ NO → Issue Assistant processes
│
└─ Regular issue → Issue Assistant processes
```

## 🧪 Testing the Filtering Logic

You can test the filtering logic using the provided test scripts:

```bash
# Test parameter extraction for OctoBeats
node .github/scripts/test-parameter-extraction.js

# Test issue filtering for Issue Assistant
node .github/scripts/test-issue-filtering.js
```

## 📝 Example Scenarios

### ✅ Scenario 1: Music Generation Request
**Issue:** `[MUSIC] Generate electronic ambient music`  
**Labels:** `audio`, `octobeats`  
**Result:** 
- ❌ Issue Assistant: Skipped (music generation issue)
- ✅ OctoBeats: Processes the request

### ✅ Scenario 2: Technical Question
**Issue:** `How to fix CSS layout issue?`  
**Labels:** `question`, `css`  
**Result:**
- ✅ Issue Assistant: Provides AI-powered assistance
- ❌ OctoBeats: Skipped (no music labels)

### ✅ Scenario 3: Bot Update
**Issue:** `Update dependency package.json`  
**Author:** `dependabot[bot]`  
**Result:**
- ❌ Issue Assistant: Skipped (bot-generated)
- ❌ OctoBeats: Skipped (no music labels)

### ✅ Scenario 4: OctoBeats Comment
**Comment:** `🎵 Audio Generated Successfully! Your audio has been generated...`  
**Author:** `github-actions[bot]`  
**Result:**
- ❌ Issue Assistant: Skipped (OctoBeats workflow comment)
- ❌ OctoBeats: Not triggered (comment event, not issue)

## 🔧 Customizing Filtering Logic

### Adding New Music-Related Keywords

To add new keywords that should trigger OctoBeats instead of Issue Assistant:

1. **Update Issue Assistant filtering** in `.github/workflows/issue-assistant.yml`:
   ```javascript
   const musicLabels = ['audio', 'octobeats', 'music-generation', 'music', 'YOUR_NEW_LABEL'];
   const musicTitlePatterns = ['[music]', '[audio]', 'music generation', 'YOUR_NEW_PATTERN'];
   ```

2. **Update OctoBeats filtering** in `.github/workflows/octobeats-music-generator.yml`:
   ```javascript
   const hasAudioLabel = labels.includes('audio') || labels.includes('octobeats') || 
                        labels.includes('music-generation') || labels.includes('YOUR_NEW_LABEL');
   ```

3. **Update test scripts** to include new test cases for the new keywords.

### Adding New Bot Patterns

To skip additional bot types in Issue Assistant:

```javascript
const botPatterns = ['bot', 'github-actions', 'dependabot', 'renovate', 'YOUR_NEW_BOT'];
```

## 🚨 Troubleshooting

### Issue Assistant Responding to Music Issues

**Problem:** Issue Assistant is responding to music generation issues.  
**Solution:** 
1. Check if the issue has the correct labels (`audio`, `octobeats`, `music-generation`)
2. Verify the title contains recognizable music patterns
3. Review the filtering logic in the Issue Assistant workflow

### OctoBeats Not Triggering

**Problem:** OctoBeats workflow not processing music issues.  
**Solution:**
1. Ensure the issue has required labels
2. Verify user has appropriate permissions
3. Check if the issue follows the template format
4. Review OctoBeats workflow logs

### Both Workflows Triggering

**Problem:** Both workflows are processing the same issue.  
**Solution:**
1. This should not happen with proper filtering
2. Check workflow logs to identify which filtering condition failed
3. Update filtering logic if new edge cases are discovered

## 📊 Monitoring Workflow Coordination

Both workflows generate detailed logs that can be downloaded as artifacts:

- **Issue Assistant:** `workflow-logs` artifact
- **OctoBeats:** `octobeats-workflow-logs-{run-number}` artifact

These logs include filtering decisions and can help debug coordination issues.

## 🔄 Future Enhancements

Potential improvements to workflow coordination:

1. **Centralized Filtering Service:** Create a shared filtering module
2. **Dynamic Label Detection:** Automatically detect music-related content
3. **User Preference System:** Allow users to choose their preferred workflow
4. **Workflow Status Integration:** Show which workflow is handling each issue

---

**📚 Related Documentation:**
- [OctoBeats Setup Guide](.github/OCTOBEATS-SETUP-GUIDE.md)
- [Issue Assistant Configuration](.github/workflows/issue-assistant.yml)
- [OctoBeats Workflow](.github/workflows/octobeats-music-generator.yml) 