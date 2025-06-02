#!/usr/bin/env node
/**
 * Create GitHub issue for music generation
 */
const fs = require('fs');
const { Octokit } = require('@octokit/rest');

function readParametersFromFile() {
    try {
        const content = fs.readFileSync('music_parameters.txt', 'utf8');
        const params = {};
        
        content.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value !== undefined) {
                params[key] = value;
            }
        });
        
        return params;
    } catch (error) {
        console.error('Error reading parameters file:', error.message);
        return null;
    }
}

function readFallbackParameters() {
    const fallbackStyles = [
        'electronic, ambient, chill',
        'acoustic, folk, peaceful',
        'jazz, smooth, relaxing',
        'classical, orchestral, elegant',
        'synthwave, retro, nostalgic'
    ];
    const fallbackDurations = [60, 90, 120];
    
    const randomStyle = fallbackStyles[Math.floor(Math.random() * fallbackStyles.length)];
    const randomDuration = fallbackDurations[Math.floor(Math.random() * fallbackDurations.length)];
    const timestamp = new Date().toTimeString().slice(0, 5).replace(':', '');
    
    return {
        STYLE_PROMPT: randomStyle,
        LYRICS: '[inst]',
        DURATION: randomDuration.toString(),
        TITLE_SUGGESTION: `Auto Generated Track ${timestamp}`,
        INSPIRATION: 'Generated using fallback parameters after AI generation failed',
        SEED: process.env.CUSTOM_SEED || '',
        SUCCESS: 'true'
    };
}

async function createIssue(params, isFallback = false) {
    const logFile = process.env.LOG_FILE;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    
    try {
        if (logFile) {
            fs.appendFileSync(logFile, `\n## Creating GitHub Issue${isFallback ? ' (Fallback)' : ''}\n`);
        }
        
        const timestampForTitle = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
        const timestampForBody = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const issueTitle = `[MUSIC] ${params.TITLE_SUGGESTION} - Auto Generated ${timestampForTitle}`;
        
        const issueBodyParts = [
            `## 🎵 Auto-Generated Music Request${isFallback ? ' (Fallback)' : ''}`,
            '',
            `This music generation request was automatically created${isFallback ? ' using fallback parameters due to AI generation failure' : ' by the Auto Music Generator workflow'}.`,
            '',
            '### 🎼 Music Style Prompt',
            params.STYLE_PROMPT,
            '',
            '### 🎤 Lyrics or Structure',
            params.LYRICS,
            '',
            '### ⏱️ Duration (seconds)',
            params.DURATION,
            '',
            '### 🎚️ Quality Mode',
            'ultra',
            ''
        ];
        
        // Add seed section if provided
        if (params.SEED && params.SEED.trim() !== '') {
            issueBodyParts.push(
                '### 🎲 Random Seed (Optional)',
                params.SEED,
                ''
            );
        }
        
        issueBodyParts.push(
            '### 📝 Additional Notes',
            `**AI Inspiration:** ${params.INSPIRATION}`,
            '',
            `**Generated at:** ${timestampForBody}`,
            `**Custom theme:** ${process.env.CUSTOM_THEME || 'None'}`,
        );
        
        if (params.SEED && params.SEED.trim() !== '') {
            issueBodyParts.push(`**Seed:** ${params.SEED} (for reproducible generation)`);
        }
        
        issueBodyParts.push(
            '',
            '---',
            '',
            '### ✅ Confirmation',
            '- [x] I have the necessary permissions (owner/admin/maintainer) to request audio generation',
            '- [x] I understand that the OctoBeats server must be running for this to work',
            '- [x] I understand that this will create a new branch and pull request with the generated audio',
            '- [x] The parameters I have provided are appropriate and follow community guidelines',
            '',
            '---',
            '',
            `*This issue was automatically generated${isFallback ? ' using fallback parameters after AI generation failed' : ' by the Auto Music Generator workflow. The parameters were created using DeepSeek-V3 AI model to ensure creative diversity and musical interest'}.*`
        );
        
        const issueBody = issueBodyParts.join('\n');
        
        const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
        
        const labels = ['audio', 'octobeats', 'auto-generated'];
        if (isFallback) {
            labels.push('fallback');
        }
        
        const issue = await octokit.rest.issues.create({
            owner: owner,
            repo: repo,
            title: issueTitle,
            body: issueBody,
            labels: labels
        });
        
        if (logFile) {
            fs.appendFileSync(logFile, `✅ Created issue #${issue.data.number}: "${issue.data.title}"\n`);
            fs.appendFileSync(logFile, `🔗 Issue URL: ${issue.data.html_url}\n`);
        }
        
        // Write outputs to file for workflow consumption
        const outputData = `issue_number=${issue.data.number}\nissue_url=${issue.data.html_url}\nissue_title=${issue.data.title.replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/:/g, '%3A')}\n`;
        fs.appendFileSync(process.env.GITHUB_OUTPUT, outputData);
        
        console.log(`✅ Successfully created issue #${issue.data.number}`);
        return true;
        
    } catch (error) {
        if (logFile) {
            fs.appendFileSync(logFile, `❌ Error creating GitHub issue: ${error.message}\n`);
        }
        console.error(`❌ Error creating issue: ${error.message}`);
        return false;
    }
}

async function main() {
    // Read parameters from file
    let params = readParametersFromFile();
    let isFallback = false;
    
    // If parameters file doesn't exist or indicates failure, use fallback
    if (!params || params.SUCCESS !== 'true') {
        console.log('Using fallback parameters...');
        params = readFallbackParameters();
        isFallback = true;
    }
    
    // Create the issue
    const success = await createIssue(params, isFallback);
    process.exit(success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
} 