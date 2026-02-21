# Antigravity Quotas

Antigravity Quotas is a VS Code extension that helps you monitor your AI model usage directly from your status bar. It works on **Windows, Linux, and macOS**.

## Features

- **Grouped Monitoring**: Track different model categories (Flash, Pro, Claude/GPT-OSS) in separate status bar items.
- **Worst-Case Display**: Each group shows the lowest quota percentage among its members.
- **Color-Coded Status**:
  - 🟢 Green: >= 40%
  - 🟡 Yellow: >= 20%
  - 🔴 Red: < 20%
- **Live Updates**: Automatic background checks every 30 seconds.
- **Model Nicknames**: Assign short, friendly names to long model labels.
- **Auto-Activation**: Starts instantly when the IDE finishes loading.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Compile and package:
   ```bash
   npm run compile
   npx @vscode/vsce package --no-git-tag-version
   ```
3. Install to Antigravity IDE:
   ```bash
   antigravity --install-extension antigravity-quotas-0.0.1.vsix
   ```

## Configuration

You can customize the groups and keywords in your VS Code settings:

```json
"antigravityQuotas.groups": [
  { "name": "Flash", "patterns": ["Flash"] },
  { "name": "Pro", "patterns": ["Pro"] },
  { "name": "Claude", "patterns": ["Claude", "GPT-OSS"] }
]
```

## Security

Antigravity Quotas is designed with security and privacy in mind:

- **Local Communication**: The extension only communicates with the `language_server` process running on `127.0.0.1` (localhost).
- **No External Data Transmission**: No data, credentials, or telemetry are sent to any external or unknown destinations.
- **Secure Token Handling**: The extension dynamically retrieves the CSRF token from the local environment to authenticate with the local language server, ensuring requests are authorized without hardcoding secrets.
- **Minimal Permissions**: The extension only requires permissions to interact with the local filesystem and network (for localhost communication).

## Requirements

- Antigravity IDE
- `language_server` process running (usually part of the Antigravity installation)

## License

MIT
